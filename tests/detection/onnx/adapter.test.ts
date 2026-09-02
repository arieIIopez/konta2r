import { describe, expect, it } from 'vitest';
import type { RawDetection } from '../../../src/core/types';
import { OnnxDetectorAdapter } from '../../../src/detection/onnx/adapter';
import type { OnnxDetectorCodec, OnnxPreparedInput } from '../../../src/detection/onnx/codec';
import type {
  OnnxExecutionProvider,
  OnnxModelSource,
  OnnxSessionFactory,
  OnnxSessionLike,
  OnnxValueMap,
} from '../../../src/detection/onnx/runtime';
import type { DetectorInput } from '../../../src/detection/types';

interface TestContext {
  frameId: number;
}

class FakeSession implements OnnxSessionLike {
  runCount = 0;
  releaseCount = 0;
  outputDisposeCount = 0;

  async run(): Promise<OnnxValueMap> {
    this.runCount += 1;
    return {
      output: {
        dispose: () => { this.outputDisposeCount += 1; },
      },
    };
  }

  release(): void {
    this.releaseCount += 1;
  }
}

class FakeFactory implements OnnxSessionFactory {
  createCount = 0;
  readonly session = new FakeSession();

  async create(
    _source: OnnxModelSource,
    _executionProviders: readonly OnnxExecutionProvider[],
  ): Promise<OnnxSessionLike> {
    this.createCount += 1;
    return this.session;
  }
}

class FakeCodec implements OnnxDetectorCodec<TestContext> {
  preparedDisposeCount = 0;
  decodeCount = 0;

  async prepare(_input: DetectorInput): Promise<OnnxPreparedInput<TestContext>> {
    return {
      feeds: { image: {} },
      context: { frameId: 7 },
      dispose: () => { this.preparedDisposeCount += 1; },
    };
  }

  decode(_outputs: OnnxValueMap, context: TestContext): RawDetection[] {
    this.decodeCount += 1;
    if (context.frameId !== 7) throw new Error('wrong codec context');
    return [
      { classId: 2, className: 'car', confidence: 0.91, bbox: { x: 1, y: 2, width: 30, height: 20 } },
      { classId: 0, className: 'person', confidence: 0.96, bbox: { x: 4, y: 5, width: 10, height: 40 } },
      { classId: 1, className: 'bicycle', confidence: 0.75, bbox: { x: 8, y: 9, width: -3, height: 10 } },
    ];
  }
}

const input: DetectorInput = {
  source: {} as CanvasImageSource,
  sourceWidth: 640,
  sourceHeight: 360,
  timestampMs: 1234,
};

const model = {
  adapterId: 'test-adapter',
  modelId: 'test-model',
  modelVersion: '1',
  weightsRedistributionVerified: false,
  inputWidth: 640,
  inputHeight: 640,
  classNames: ['person', 'bicycle', 'car'],
  registeredAtIso: '2026-08-30T00:00:00.000Z',
};

describe('OnnxDetectorAdapter', () => {
  it('initializes one session, filters/sorts detections and emits reproducible telemetry', async () => {
    const factory = new FakeFactory();
    const codec = new FakeCodec();
    const adapter = new OnnxDetectorAdapter({
      model,
      modelSource: 'model.onnx',
      codec,
      capabilities: { webgpu: false },
      sessionFactory: factory,
      maxDetections: 1,
      minConfidence: 0.5,
    });

    const [firstInitialization, secondInitialization] = await Promise.all([
      adapter.initialize(),
      adapter.initialize(),
    ]);

    expect(factory.createCount).toBe(1);
    expect(firstInitialization.runtime.backend).toBe('wasm');
    expect(secondInitialization.model.modelId).toBe('test-model');

    const output = await adapter.detect(input);
    expect(output.timestampMs).toBe(1234);
    expect(output.telemetry.detectionCountBeforeFiltering).toBe(3);
    expect(output.telemetry.detectionCount).toBe(1);
    expect(output.detections).toHaveLength(1);
    expect(output.detections[0]?.className).toBe('person');
    expect(output.telemetry.preprocessMs).toBeGreaterThanOrEqual(0);
    expect(output.telemetry.inferenceMs).toBeGreaterThanOrEqual(0);
    expect(output.telemetry.postprocessMs).toBeGreaterThanOrEqual(0);
    expect(output.telemetry.totalMs).toBeGreaterThanOrEqual(0);
    expect(factory.session.outputDisposeCount).toBe(1);
    expect(codec.preparedDisposeCount).toBe(1);

    await adapter.dispose();
    expect(factory.session.releaseCount).toBe(1);
    expect(adapter.getInitialization()).toBeNull();
  });

  it('enforces the bundled-production license gate separately from experiments', async () => {
    const adapter = new OnnxDetectorAdapter({
      model,
      modelSource: 'model.onnx',
      codec: new FakeCodec(),
      capabilities: { webgpu: false },
      sessionFactory: new FakeFactory(),
      eligibilityMode: 'bundled_production',
    });

    await expect(adapter.initialize()).rejects.toThrow('not eligible for bundled production');
  });
});
