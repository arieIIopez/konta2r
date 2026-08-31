import type { Detector, DetectorInitialization, DetectorOutput } from './types';
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

export interface AnnotatedDetectorBenchmarkOptions {
  iouThreshold?: number;
  imageScaleThresholds?: ImageScaleThresholds;
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

/**
 * Runs one detector against an annotated sequence. The detector is initialized
 * once, every frame is matched class-aware with Hungarian assignment, and the
 * detector is released by default so multiple candidate models can be tested
 * sequentially on memory-constrained devices.
 */
export async function runAnnotatedDetectorBenchmark(
  detector: Detector,
  frames: readonly AnnotatedBenchmarkFrameInput[],
  options: AnnotatedDetectorBenchmarkOptions = {},
): Promise<AnnotatedDetectorBenchmarkResult> {
  const iouThreshold = options.iouThreshold ?? 0.5;
  const imageScaleThresholds = options.imageScaleThresholds ?? DEFAULT_IMAGE_SCALE_THRESHOLDS;
  const disposeAfterRun = options.disposeDetectorAfterRun ?? true;
  const initialization = await detector.initialize();
  const outputs: DetectorOutput[] = [];
  const accuracyObservations = [];
  const frameRecords: AnnotatedBenchmarkFrameRecord[] = [];
  const scaleCounters = new Map<string, StratumCounter>();
  const occlusionCounters = new Map<string, StratumCounter>();
  const matchedIoUs: number[] = [];
  let evaluatedGroundTruthCount = 0;
  let ignoredGroundTruthCount = 0;
  let ignoredDetectionCount = 0;

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
      outputs.push(output);

      const evaluation = evaluateDetectionsAgainstGroundTruth(
        output.detections,
        frame.objects,
        frame.height,
        { iouThreshold, scaleThresholds: imageScaleThresholds },
      );
      accuracyObservations.push(...evaluation.accuracyObservations);
      matchedIoUs.push(...evaluation.matches.map((match) => match.iou));
      ignoredDetectionCount += evaluation.ignoredDetectionIndices.length;
      const counts = updateDifficultyStrata(
        frame,
        evaluation,
        imageScaleThresholds,
        scaleCounters,
        occlusionCounters,
      );
      evaluatedGroundTruthCount += counts.evaluated;
      ignoredGroundTruthCount += counts.ignored;

      frameRecords.push({
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

    const aggregate = buildDetectorBenchmarkResult(outputs, accuracyObservations);
    return {
      schemaVersion: '1',
      detector: {
        model: {
          ...initialization.model,
          classNames: [...initialization.model.classNames],
        },
        runtime: {
          ...initialization.runtime,
          executionProviders: [...initialization.runtime.executionProviders],
        },
      },
      frameCount: frames.length,
      evaluatedGroundTruthCount,
      ignoredGroundTruthCount,
      ignoredDetectionCount,
      matchedIoUMean: mean(matchedIoUs),
      matching: {
        iouThreshold,
        imageScaleThresholds: { ...imageScaleThresholds },
      },
      recallByImageScale: finalizeStrata(scaleCounters),
      recallByOcclusion: finalizeStrata(occlusionCounters),
      frames: frameRecords,
      ...aggregate,
    };
  } finally {
    if (disposeAfterRun) await detector.dispose();
  }
}
