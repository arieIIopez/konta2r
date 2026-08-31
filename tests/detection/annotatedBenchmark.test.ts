import { describe, expect, it } from 'vitest';
import type {
  Detector,
  DetectorInitialization,
  DetectorInput,
  DetectorOutput,
} from '../../src/detection/types';
import type { RawDetection } from '../../src/core/types';
import { runAnnotatedDetectorBenchmark } from '../../src/detection/annotatedBenchmark';
import type { AnnotatedBenchmarkFrameInput } from '../../src/detection/annotatedBenchmark';

function raw(
  className: string,
  x: number,
  y: number,
  width: number,
  height: number,
  confidence = 0.9,
): RawDetection {
  return { classId: 0, className, confidence, bbox: { x, y, width, height } };
}

class MockDetector implements Detector {
  private initialization: DetectorInitialization | null = null;
  private index = 0;
  disposed = false;

  constructor(private readonly outputs: RawDetection[][]) {}

  async initialize(): Promise<DetectorInitialization> {
    this.initialization = {
      model: {
        adapterId: 'mock',
        modelId: 'benchmark-model',
        modelVersion: '1',
        modelSha256: 'a'.repeat(64),
        weightsRedistributionVerified: false,
        inputWidth: 300,
        inputHeight: 300,
        classNames: ['person', 'bicycle', 'car'],
      },
      runtime: {
        runtime: 'other',
        backend: 'unknown',
        executionProviders: ['unknown'],
      },
    };
    return this.initialization;
  }

  async detect(input: DetectorInput): Promise<DetectorOutput> {
    const detections = this.outputs[this.index] ?? [];
    const current = this.index;
    this.index += 1;
    const totalMs = current === 0 ? 10 : 20;
    return {
      detections,
      timestampMs: input.timestampMs,
      telemetry: {
        preprocessMs: 1,
        inferenceMs: totalMs - 2,
        postprocessMs: 1,
        totalMs,
        detectionCountBeforeFiltering: detections.length,
        detectionCount: detections.length,
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

const source = {} as CanvasImageSource;

const frames: AnnotatedBenchmarkFrameInput[] = [
  {
    source,
    annotation: {
      frameId: 'f1',
      timestampMs: 1000,
      width: 1000,
      height: 500,
      objects: [
        { annotationId: 'p1', className: 'person', bbox: { x: 10, y: 10, width: 50, height: 100 } },
        { annotationId: 'b1', className: 'bicycle', bbox: { x: 200, y: 10, width: 40, height: 15 } },
      ],
    },
  },
  {
    source,
    annotation: {
      frameId: 'f2',
      timestampMs: 1200,
      width: 1000,
      height: 500,
      objects: [
        {
          annotationId: 'p2',
          className: 'person',
          bbox: { x: 20, y: 20, width: 50, height: 100 },
          occlusion: 'partial',
        },
        { annotationId: 'b2', className: 'bicycle', bbox: { x: 300, y: 20, width: 40, height: 50 } },
        {
          annotationId: 'ignored-person',
          className: 'person',
          bbox: { x: 500, y: 20, width: 50, height: 100 },
          occlusion: 'heavy',
          ignore: true,
        },
      ],
    },
  },
];

describe('annotated detector benchmark harness', () => {
  it('combines latency, class accuracy and difficulty-stratified recall', async () => {
    const detector = new MockDetector([
      [
        raw('person', 10, 10, 50, 100, 0.95),
        raw('car', 700, 50, 80, 60, 0.75),
      ],
      [
        raw('bicycle', 300, 20, 40, 50, 0.92),
        raw('person', 500, 20, 50, 100, 0.91),
      ],
    ]);

    const result = await runAnnotatedDetectorBenchmark(detector, frames);

    expect(result.frameCount).toBe(2);
    expect(result.evaluatedGroundTruthCount).toBe(4);
    expect(result.ignoredGroundTruthCount).toBe(1);
    expect(result.ignoredDetectionCount).toBe(1);
    expect(result.matchedIoUMean).toBeCloseTo(1, 6);
    expect(result.latency.totalMsMean).toBe(15);
    expect(result.latency.totalMsP95).toBe(20);

    expect(result.classMetrics.find((metric) => metric.className === 'person')).toMatchObject({
      truePositive: 1,
      falsePositive: 0,
      falseNegative: 1,
      precision: 1,
      recall: 0.5,
    });
    expect(result.classMetrics.find((metric) => metric.className === 'bicycle')).toMatchObject({
      truePositive: 1,
      falsePositive: 0,
      falseNegative: 1,
      precision: 1,
      recall: 0.5,
    });
    expect(result.classMetrics.find((metric) => metric.className === 'car')).toMatchObject({
      truePositive: 0,
      falsePositive: 1,
      falseNegative: 0,
    });

    expect(result.recallByImageScale.find((item) => item.className === 'bicycle' && item.value === 'tiny')).toMatchObject({
      groundTruthCount: 1,
      truePositive: 0,
      recall: 0,
    });
    expect(result.recallByOcclusion.find((item) => item.className === 'person' && item.value === 'partial')).toMatchObject({
      groundTruthCount: 1,
      truePositive: 0,
      recall: 0,
    });
    expect(result.recallByOcclusion.find((item) => item.className === 'person' && item.value === 'none')).toMatchObject({
      groundTruthCount: 1,
      truePositive: 1,
      recall: 1,
    });
    expect(detector.disposed).toBe(true);
  });

  it('can retain a detector session for repeated benchmark passes when requested', async () => {
    const detector = new MockDetector([[]]);
    await runAnnotatedDetectorBenchmark(detector, [frames[0]!], { disposeDetectorAfterRun: false });
    expect(detector.disposed).toBe(false);
  });
});
