import { describe, expect, it } from 'vitest';
import type {
  Detector,
  DetectorInitialization,
  DetectorInput,
  DetectorOutput,
} from '../../src/detection/types';
import type { AnnotatedBenchmarkSequence } from '../../src/detection/benchmarkDataset';
import {
  runStreamingAnnotatedBenchmark,
  type BenchmarkFrameProvider,
} from '../../src/detection/streamingBenchmark';

class EmptyDetector implements Detector {
  protected initialization: DetectorInitialization | null = null;
  protected calls = 0;
  disposed = false;

  async initialize(): Promise<DetectorInitialization> {
    this.initialization = {
      model: {
        adapterId: 'mock',
        modelId: 'stream-test',
        modelVersion: '1',
        weightsRedistributionVerified: false,
        inputWidth: 300,
        inputHeight: 300,
        classNames: ['person'],
      },
      runtime: { runtime: 'other', backend: 'unknown', executionProviders: ['unknown'] },
    };
    return this.initialization;
  }

  async detect(input: DetectorInput): Promise<DetectorOutput> {
    this.calls += 1;
    return {
      detections: [],
      timestampMs: input.timestampMs,
      telemetry: {
        preprocessMs: 1,
        inferenceMs: 2,
        postprocessMs: 1,
        totalMs: 4,
        detectionCountBeforeFiltering: 0,
        detectionCount: 0,
      },
    };
  }

  dispose(): void {
    this.disposed = true;
    this.initialization = null;
  }

  getInitialization(): DetectorInitialization | null {
    return this.initialization;
  }
}

class FailingDetector extends EmptyDetector {
  override async detect(input: DetectorInput): Promise<DetectorOutput> {
    if (input.timestampMs >= 200) throw new Error('synthetic inference failure');
    return super.detect(input);
  }
}

const sequence: AnnotatedBenchmarkSequence = {
  schemaVersion: '1',
  datasetId: 'stream-dataset',
  sequenceId: 'stream-sequence',
  frames: [
    { frameId: 'f1', timestampMs: 100, width: 640, height: 360, objects: [] },
    { frameId: 'f2', timestampMs: 200, width: 640, height: 360, objects: [] },
    { frameId: 'f3', timestampMs: 300, width: 640, height: 360, objects: [] },
  ],
};

const source = {} as CanvasImageSource;

describe('streaming annotated benchmark', () => {
  it('materializes and releases one frame at a time while reporting progress', async () => {
    const detector = new EmptyDetector();
    let active = 0;
    let maxActive = 0;
    let released = 0;
    const progress: string[] = [];

    const provider: BenchmarkFrameProvider = {
      async materialize() {
        active += 1;
        maxActive = Math.max(maxActive, active);
        return {
          source,
          release() {
            active -= 1;
            released += 1;
          },
        };
      },
    };

    const result = await runStreamingAnnotatedBenchmark(detector, sequence, provider, {
      onProgress: (value) => progress.push(`${value.completedFrames}/${value.totalFrames}:${value.frameId}`),
    });

    expect(result.frameCount).toBe(3);
    expect(maxActive).toBe(1);
    expect(active).toBe(0);
    expect(released).toBe(3);
    expect(progress).toEqual(['1/3:f1', '2/3:f2', '3/3:f3']);
    expect(detector.disposed).toBe(true);
  });

  it('releases the current frame and detector when inference fails', async () => {
    const detector = new FailingDetector();
    let active = 0;
    let released = 0;
    const provider: BenchmarkFrameProvider = {
      async materialize() {
        active += 1;
        return {
          source,
          release() {
            active -= 1;
            released += 1;
          },
        };
      },
    };

    await expect(runStreamingAnnotatedBenchmark(detector, sequence, provider))
      .rejects.toThrow('synthetic inference failure');

    expect(active).toBe(0);
    expect(released).toBe(2);
    expect(detector.disposed).toBe(true);
  });
});
