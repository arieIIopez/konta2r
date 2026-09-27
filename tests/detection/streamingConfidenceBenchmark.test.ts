import { describe, expect, it } from 'vitest';
import type { AnnotatedBenchmarkSequence } from '../../src/detection/benchmarkDataset';
import { runStreamingAnnotatedBenchmarkWithConfidenceSweep } from '../../src/detection/streamingConfidenceBenchmark';
import type {
  Detector,
  DetectorInitialization,
  DetectorInput,
  DetectorOutput,
} from '../../src/detection/types';
import type { BenchmarkFrameProvider } from '../../src/detection/streamingBenchmark';

const initialization: DetectorInitialization = {
  model: {
    adapterId: 'test',
    modelId: 'confidence-test',
    modelVersion: '1',
    modelSha256: 'a'.repeat(64),
    weightsRedistributionVerified: false,
    inputWidth: 300,
    inputHeight: 300,
    classNames: ['person'],
  },
  runtime: {
    runtime: 'other',
    backend: 'wasm',
    executionProviders: ['wasm'],
  },
};

class TestDetector implements Detector {
  detectCount = 0;
  disposeCount = 0;
  async initialize(): Promise<DetectorInitialization> { return initialization; }
  getInitialization(): DetectorInitialization | null { return initialization; }
  async detect(input: DetectorInput): Promise<DetectorOutput> {
    this.detectCount += 1;
    return {
      timestampMs: input.timestampMs,
      telemetry: {
        preprocessMs: 1,
        inferenceMs: 8,
        postprocessMs: 1,
        totalMs: 10,
        detectionCountBeforeFiltering: 2,
        detectionCount: 2,
      },
      detections: [
        {
          classId: 1,
          className: 'person',
          confidence: 0.9,
          bbox: { x: 100, y: 50, width: 200, height: 300 },
        },
        {
          classId: 1,
          className: 'person',
          confidence: 0.2,
          bbox: { x: 700, y: 50, width: 100, height: 250 },
        },
      ],
    };
  }
  dispose(): void { this.disposeCount += 1; }
}

const sequence: AnnotatedBenchmarkSequence = {
  schemaVersion: '1',
  datasetId: 'confidence-sequence',
  sequenceId: 'seq-1',
  frames: [{
    frameId: 'f1',
    timestampMs: 1_000,
    mediaTimeMs: 500,
    width: 1_000,
    height: 500,
    objects: [{
      annotationId: 'person-1',
      className: 'person',
      bbox: { x: 100, y: 50, width: 200, height: 300 },
    }],
  }],
};

const provider: BenchmarkFrameProvider = {
  async materialize() {
    return { source: {} as CanvasImageSource, actualMediaTimeMs: 500 };
  },
};

describe('streaming confidence benchmark', () => {
  it('runs inference once while evaluating primary and sweep thresholds separately', async () => {
    const detector = new TestDetector();
    const result = await runStreamingAnnotatedBenchmarkWithConfidenceSweep(
      detector,
      sequence,
      provider,
      {
        operatingConfidenceThreshold: 0.5,
        sweepThresholds: [0.1, 0.5, 0.95],
        iouThreshold: 0.5,
      },
    );

    expect(detector.detectCount).toBe(1);
    expect(detector.disposeCount).toBe(1);
    expect(result.operatingConfidenceThreshold).toBe(0.5);
    expect(result.benchmark.classMetrics[0]).toMatchObject({
      truePositive: 1,
      falsePositive: 0,
      falseNegative: 0,
      f1: 1,
    });
    expect(result.benchmark.frames[0]?.detectionCount).toBe(1);
    expect(result.confidenceSweep.points[0]?.classMetrics[0]).toMatchObject({
      truePositive: 1,
      falsePositive: 1,
      falseNegative: 0,
      precision: 0.5,
      recall: 1,
    });
    expect(result.confidenceSweep.points[2]?.classMetrics[0]).toMatchObject({
      truePositive: 0,
      falsePositive: 0,
      falseNegative: 1,
    });
  });

  it('rejects a sweep whose lowest threshold is above the operating point', async () => {
    const detector = new TestDetector();
    await expect(runStreamingAnnotatedBenchmarkWithConfidenceSweep(
      detector,
      sequence,
      provider,
      { operatingConfidenceThreshold: 0.4, sweepThresholds: [0.5, 0.8] },
    )).rejects.toThrow('cannot exceed the operating threshold');
    expect(detector.disposeCount).toBe(0);
  });
});
