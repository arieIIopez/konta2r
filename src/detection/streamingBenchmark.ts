import type { Detector } from './types';
import {
  AnnotatedBenchmarkAccumulator,
  type AnnotatedBenchmarkEvaluationOptions,
  type AnnotatedDetectorBenchmarkResult,
} from './annotatedBenchmark';
import {
  validateAnnotatedBenchmarkSequence,
  type AnnotatedBenchmarkFrame,
  type AnnotatedBenchmarkSequence,
} from './benchmarkDataset';

export interface MaterializedBenchmarkFrame {
  source: CanvasImageSource;
  actualMediaTimeMs?: number;
  release?: () => Promise<void> | void;
}

export interface BenchmarkFrameProvider {
  materialize(frame: AnnotatedBenchmarkFrame): Promise<MaterializedBenchmarkFrame>;
}

export interface StreamingBenchmarkProgress {
  completedFrames: number;
  totalFrames: number;
  frameId: string;
}

export interface StreamingBenchmarkOptions extends AnnotatedBenchmarkEvaluationOptions {
  disposeDetectorAfterRun?: boolean;
  onProgress?: (progress: StreamingBenchmarkProgress) => void;
}

/**
 * Materializes exactly one source frame at a time. The frame is released in a
 * finally block before the next annotation is requested, even when detection
 * or evaluation fails. This is the preferred path for long videos on old phones.
 */
export async function runStreamingAnnotatedBenchmark(
  detector: Detector,
  sequence: AnnotatedBenchmarkSequence,
  provider: BenchmarkFrameProvider,
  options: StreamingBenchmarkOptions = {},
): Promise<AnnotatedDetectorBenchmarkResult> {
  validateAnnotatedBenchmarkSequence(sequence);
  const disposeAfterRun = options.disposeDetectorAfterRun ?? true;
  const initialization = await detector.initialize();
  const accumulator = new AnnotatedBenchmarkAccumulator(initialization, {
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
        accumulator.addFrame(frame, output, {
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

    return accumulator.finalize();
  } finally {
    if (disposeAfterRun) await detector.dispose();
  }
}
