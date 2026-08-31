import type {
  Detector,
  DetectorAccuracyObservation,
  DetectorInitialization,
  DetectorOutput,
} from './types';
import { buildDetectorBenchmarkResult, type DetectorBenchmarkResult } from './benchmark';
import {
  DEFAULT_IMAGE_SCALE_THRESHOLDS,
  classifyImageScale,
  validateAnnotatedBenchmarkFrame,
  type AnnotatedBenchmarkFrame,
  type GroundTruthOcclusion,
  type ImageScaleBin,
  type ImageScaleThresholds,
} from './benchmarkDataset';
import {
  evaluateDetectionsAgainstGroundTruth,
  type DetectionGroundTruthMatch,
  type FrameDetectionEvaluation,
} from './groundTruthMatching';

export interface AnnotatedBenchmarkFrameInput {
  annotation: AnnotatedBenchmarkFrame;
  source: CanvasImageSource;
}

export interface RecallStratum {
  className: string;
  value: string;
  groundTruthCount: number;
  truePositive: number;
  falseNegative: number;
  recall: number;
}

export interface AnnotatedBenchmarkFrameRecord {
  frameId: string;
  timestampMs: number;
  detectionCount: number;
  matchCount: number;
  falsePositiveCount: number;
  falseNegativeCount: number;
  ignoredDetectionCount: number;
  matches: DetectionGroundTruthMatch[];
}

export interface AnnotatedDetectorBenchmarkResult extends DetectorBenchmarkResult {
  schemaVersion: '1';
  detector: DetectorInitialization;
  frameCount: number;
  evaluatedGroundTruthCount: number;
  ignoredGroundTruthCount: number;
  ignoredDetectionCount: number;
  matchedIoUMean: number;
  matching: {
    iouThreshold: number;
    imageScaleThresholds: ImageScaleThresholds;
  };
  recallByImageScale: RecallStratum[];
  recallByOcclusion: RecallStratum[];
  frames: AnnotatedBenchmarkFrameRecord[];
}

export interface AnnotatedBenchmarkEvaluationOptions {
  iouThreshold?: number;
  imageScaleThresholds?: ImageScaleThresholds;
}

export interface AnnotatedDetectorBenchmarkOptions extends AnnotatedBenchmarkEvaluationOptions {
  disposeDetectorAfterRun?: boolean;
}

interface StratumCounter {
  className: string;
  value: string;
  groundTruthCount: number;
  truePositive: number;
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function pushCounter(
  map: Map<string, StratumCounter>,
  className: string,
  value: string,
  matched: boolean,
): void {
  const key = `${className}\u0000${value}`;
  const counter = map.get(key) ?? { className, value, groundTruthCount: 0, truePositive: 0 };
  counter.groundTruthCount += 1;
  if (matched) counter.truePositive += 1;
  map.set(key, counter);
}

function finalizeStrata(map: Map<string, StratumCounter>): RecallStratum[] {
  return [...map.values()]
    .map((counter) => {
      const falseNegative = counter.groundTruthCount - counter.truePositive;
      return {
        className: counter.className,
        value: counter.value,
        groundTruthCount: counter.groundTruthCount,
        truePositive: counter.truePositive,
        falseNegative,
        recall: counter.groundTruthCount === 0 ? 0 : counter.truePositive / counter.groundTruthCount,
      };
    })
    .sort((a, b) => a.className.localeCompare(b.className) || a.value.localeCompare(b.value));
}

function updateDifficultyStrata(
  frame: AnnotatedBenchmarkFrame,
  evaluation: FrameDetectionEvaluation,
  scaleThresholds: ImageScaleThresholds,
  scaleCounters: Map<string, StratumCounter>,
  occlusionCounters: Map<string, StratumCounter>,
): { evaluated: number; ignored: number } {
  const matchedIds = new Set(evaluation.matches.map((match) => match.annotationId));
  let evaluated = 0;
  let ignored = 0;

  for (const object of frame.objects) {
    if (object.ignore) {
      ignored += 1;
      continue;
    }
    evaluated += 1;
    const matched = matchedIds.has(object.annotationId);
    const scale: ImageScaleBin = classifyImageScale(object.bbox, frame.height, scaleThresholds);
    const occlusion: GroundTruthOcclusion = object.occlusion ?? 'none';
    pushCounter(scaleCounters, object.className, scale, matched);
    pushCounter(occlusionCounters, object.className, occlusion, matched);
  }
  return { evaluated, ignored };
}

function cloneInitialization(initialization: DetectorInitialization): DetectorInitialization {
  return {
    model: {
      ...initialization.model,
      classNames: [...initialization.model.classNames],
    },
    runtime: {
      ...initialization.runtime,
      executionProviders: [...initialization.runtime.executionProviders],
    },
  };
}

/**
 * Stateful accumulator shared by in-memory and streaming benchmark runners.
 * It never retains CanvasImageSource objects; only detector outputs and compact
 * evaluation records enter the final result.
 */
export class AnnotatedBenchmarkAccumulator {
  private readonly initialization: DetectorInitialization;
  private readonly iouThreshold: number;
  private readonly imageScaleThresholds: ImageScaleThresholds;
  private readonly outputs: DetectorOutput[] = [];
  private readonly accuracyObservations: DetectorAccuracyObservation[] = [];
  private readonly frameRecords: AnnotatedBenchmarkFrameRecord[] = [];
  private readonly scaleCounters = new Map<string, StratumCounter>();
  private readonly occlusionCounters = new Map<string, StratumCounter>();
  private readonly matchedIoUs: number[] = [];
  private evaluatedGroundTruthCount = 0;
  private ignoredGroundTruthCount = 0;
  private ignoredDetectionCount = 0;

  constructor(
    initialization: DetectorInitialization,
    options: AnnotatedBenchmarkEvaluationOptions = {},
  ) {
    this.initialization = cloneInitialization(initialization);
    this.iouThreshold = options.iouThreshold ?? 0.5;
    this.imageScaleThresholds = {
      ...(options.imageScaleThresholds ?? DEFAULT_IMAGE_SCALE_THRESHOLDS),
    };
  }

  addFrame(frame: AnnotatedBenchmarkFrame, output: DetectorOutput): void {
    validateAnnotatedBenchmarkFrame(frame);
    this.outputs.push({
      ...output,
      detections: output.detections.map((detection) => ({
        ...detection,
        bbox: { ...detection.bbox },
      })),
      telemetry: { ...output.telemetry },
    });

    const evaluation = evaluateDetectionsAgainstGroundTruth(
      output.detections,
      frame.objects,
      frame.height,
      { iouThreshold: this.iouThreshold, scaleThresholds: this.imageScaleThresholds },
    );
    this.accuracyObservations.push(...evaluation.accuracyObservations);
    this.matchedIoUs.push(...evaluation.matches.map((match) => match.iou));
    this.ignoredDetectionCount += evaluation.ignoredDetectionIndices.length;
    const counts = updateDifficultyStrata(
      frame,
      evaluation,
      this.imageScaleThresholds,
      this.scaleCounters,
      this.occlusionCounters,
    );
    this.evaluatedGroundTruthCount += counts.evaluated;
    this.ignoredGroundTruthCount += counts.ignored;

    this.frameRecords.push({
      frameId: frame.frameId,
      timestampMs: frame.timestampMs,
      detectionCount: output.detections.length,
      matchCount: evaluation.matches.length,
      falsePositiveCount: evaluation.falsePositiveDetectionIndices.length,
      falseNegativeCount: evaluation.falseNegativeAnnotationIds.length,
      ignoredDetectionCount: evaluation.ignoredDetectionIndices.length,
      matches: evaluation.matches.map((match) => ({ ...match })),
    });
  }

  finalize(): AnnotatedDetectorBenchmarkResult {
    const aggregate = buildDetectorBenchmarkResult(this.outputs, this.accuracyObservations);
    return {
      schemaVersion: '1',
      detector: cloneInitialization(this.initialization),
      frameCount: this.frameRecords.length,
      evaluatedGroundTruthCount: this.evaluatedGroundTruthCount,
      ignoredGroundTruthCount: this.ignoredGroundTruthCount,
      ignoredDetectionCount: this.ignoredDetectionCount,
      matchedIoUMean: mean(this.matchedIoUs),
      matching: {
        iouThreshold: this.iouThreshold,
        imageScaleThresholds: { ...this.imageScaleThresholds },
      },
      recallByImageScale: finalizeStrata(this.scaleCounters),
      recallByOcclusion: finalizeStrata(this.occlusionCounters),
      frames: this.frameRecords.map((frame) => ({
        ...frame,
        matches: frame.matches.map((match) => ({ ...match })),
      })),
      ...aggregate,
    };
  }
}

/**
 * Runs one detector against already-materialized annotated frames. For large
 * media sources prefer the streaming runner, which materializes one frame at a
 * time and feeds the same accumulator.
 */
export async function runAnnotatedDetectorBenchmark(
  detector: Detector,
  frames: readonly AnnotatedBenchmarkFrameInput[],
  options: AnnotatedDetectorBenchmarkOptions = {},
): Promise<AnnotatedDetectorBenchmarkResult> {
  const disposeAfterRun = options.disposeDetectorAfterRun ?? true;
  const initialization = await detector.initialize();
  const accumulator = new AnnotatedBenchmarkAccumulator(initialization, {
    ...(options.iouThreshold === undefined ? {} : { iouThreshold: options.iouThreshold }),
    ...(options.imageScaleThresholds === undefined ? {} : { imageScaleThresholds: options.imageScaleThresholds }),
  });

  try {
    for (const frameInput of frames) {
      const frame = frameInput.annotation;
      validateAnnotatedBenchmarkFrame(frame);
      const output = await detector.detect({
        source: frameInput.source,
        sourceWidth: frame.width,
        sourceHeight: frame.height,
        timestampMs: frame.timestampMs,
      });
      accumulator.addFrame(frame, output);
    }
    return accumulator.finalize();
  } finally {
    if (disposeAfterRun) await detector.dispose();
  }
}
