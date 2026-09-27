import type { Detector, DetectorOutput } from './types';
import {
  AnnotatedBenchmarkAccumulator,
  type AnnotatedDetectorBenchmarkResult,
} from './annotatedBenchmark';
import {
  validateAnnotatedBenchmarkSequence,
  type AnnotatedBenchmarkSequence,
  type ImageScaleThresholds,
} from './benchmarkDataset';
import {
  ConfidenceSweepAccumulator,
  type ConfidenceSweepResult,
} from './confidenceSweep';
import type {
  BenchmarkFrameProvider,
  StreamingBenchmarkProgress,
} from './streamingBenchmark';

export interface StreamingConfidenceBenchmarkOptions {
  operatingConfidenceThreshold?: number;
  sweepThresholds?: readonly number[];
  iouThreshold?: number;
  imageScaleThresholds?: ImageScaleThresholds;
  disposeDetectorAfterRun?: boolean;
  onProgress?: (progress: StreamingBenchmarkProgress) => void;
}

export interface StreamingConfidenceBenchmarkResult {
  operatingConfidenceThreshold: number;
  benchmark: AnnotatedDetectorBenchmarkResult;
  confidenceSweep: ConfidenceSweepResult;
}

function confidenceThreshold(value: number | undefined): number {
  const threshold = value ?? 0.5;
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new Error('operating confidence threshold must be within [0, 1]');
  }
  return threshold;
}

function outputAtThreshold(output: DetectorOutput, threshold: number): DetectorOutput {
  const detections = output.detections
    .filter((detection) => detection.confidence >= threshold)
    .map((detection) => ({ ...detection, bbox: { ...detection.bbox } }));
  return {
    timestampMs: output.timestampMs,
    telemetry: { ...output.telemetry },
    detections,
  };
}

/**
 * Executes inference once per frame, then evaluates the primary operating point
 * and a confidence sweep from the same decoded detections. The detector's own
 * minConfidence must be less than or equal to the minimum sweep threshold.
 */
export async function runStreamingAnnotatedBenchmarkWithConfidenceSweep(
  detector: Detector,
  sequence: AnnotatedBenchmarkSequence,
  provider: BenchmarkFrameProvider,
  options: StreamingConfidenceBenchmarkOptions = {},
): Promise<StreamingConfidenceBenchmarkResult> {
  validateAnnotatedBenchmarkSequence(sequence);
  const operatingThreshold = confidenceThreshold(options.operatingConfidenceThreshold);
  const disposeAfterRun = options.disposeDetectorAfterRun ?? true;
  const sweep = new ConfidenceSweepAccumulator({
    ...(options.sweepThresholds === undefined ? {} : { thresholds: options.sweepThresholds }),
    ...(options.iouThreshold === undefined ? {} : { iouThreshold: options.iouThreshold }),
  });
  if (sweep.minimumThreshold() > operatingThreshold) {
    throw new Error('confidence sweep minimum threshold cannot exceed the operating threshold');
  }

  const initialization = await detector.initialize();
  const primary = new AnnotatedBenchmarkAccumulator(initialization, {
    ...(options.iouThreshold === undefined ? {} : { iouThreshold: options.iouThreshold }),
    ...(options.imageScaleThresholds === undefined ? {} : { imageScaleThresholds: options.imageScaleThresholds }),
  });

  try {
    let completedFrames = 0;
    for (const frame of sequence.frames) {
      const materialized = await provider.materialize(frame);
      try {
        const output = await detector.detect({
          source: materialized.source,
          sourceWidth: frame.width,
          sourceHeight: frame.height,
          timestampMs: frame.timestampMs,
        });
        sweep.addFrame(frame, output.detections);
        primary.addFrame(frame, outputAtThreshold(output, operatingThreshold), {
          ...(materialized.actualMediaTimeMs === undefined
            ? {}
            : { actualMediaTimeMs: materialized.actualMediaTimeMs }),
        });
      } finally {
        await materialized.release?.();
      }

      completedFrames += 1;
      options.onProgress?.({
        completedFrames,
        totalFrames: sequence.frames.length,
        frameId: frame.frameId,
      });
    }

    return {
      operatingConfidenceThreshold: operatingThreshold,
      benchmark: primary.finalize(),
      confidenceSweep: sweep.finalize(),
    };
  } finally {
    if (disposeAfterRun) await detector.dispose();
  }
}
