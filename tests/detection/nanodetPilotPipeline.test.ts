import { describe, expect, it } from 'vitest';
import type { Detector, DetectorInitialization, DetectorInput, DetectorOutput } from '../../src/detection/types';
import { NanoDetPilotPipeline } from '../../src/detection/nanodetPilotPipeline';
import type { NanoDetPilotLoadResult } from '../../src/detection/onnx/nanodetPilot';

class FakeDetector implements Detector {
  initializeCalls = 0;
  detectCalls = 0;
  disposeCalls = 0;

  private readonly initialization: DetectorInitialization = {
    model: {
      adapterId: 'nanodet_plus_gfl',
      modelId: 'opencv-nanodet-m-plus-1.5x-416-2022nov',
      modelVersion: 'sha256-test',
      modelSha256: 'a'.repeat(64),
      weightsRedistributionVerified: false,
      inputWidth: 416,
      inputHeight: 416,
      classNames: ['person', 'bicycle', 'car'],
    },
    runtime: {
      runtime: 'onnxruntime-web',
      runtimeVersion: '1.29.0',
      backend: 'wasm',
      executionProviders: ['wasm'],
    },
  };

  async initialize(): Promise<DetectorInitialization> {
    this.initializeCalls += 1;
    return this.initialization;
  }

  async detect(input: DetectorInput): Promise<DetectorOutput> {
    this.detectCalls += 1;
    return {
      detections: [{
        classId: 0,
        className: 'person',
        confidence: 0.9,
        bbox: { x: 10, y: 10, width: 30, height: 70 },
      }],
      timestampMs: input.timestampMs,
      telemetry: {
        preprocessMs: 5,
        inferenceMs: 20,
        postprocessMs: 4,
        totalMs: 29,
        detectionCountBeforeFiltering: 1,
        detectionCount: 1,
      },
    };
  }

  async dispose(): Promise<void> {
    this.disposeCalls += 1;
  }

  getInitialization(): DetectorInitialization | null {
    return this.initializeCalls > 0 ? this.initialization : null;
  }
}

function loaded(detector: Detector): NanoDetPilotLoadResult {
  return {
    detector,
    candidateId: 'opencv-nanodet-m-plus-1.5x-416-2022nov',
    modelSha256: 'a'.repeat(64),
    artifactSource: 'cache',
    cachePersisted: true,
    redistributionVerified: false,
  };
}

describe('NanoDetPilotPipeline', () => {
  it('does not load the external candidate until initialization is requested', async () => {
    const detector = new FakeDetector();
    let loaderCalls = 0;
    const pipeline = new NanoDetPilotPipeline({
      sessionId: 'session_test',
      loader: async () => {
        loaderCalls += 1;
        return loaded(detector);
      },
    });

    expect(loaderCalls).toBe(0);
    expect(pipeline.snapshot()).toEqual({ state: 'idle' });

    const initialization = await pipeline.initialize();
    expect(loaderCalls).toBe(1);
    expect(detector.initializeCalls).toBe(1);
    expect(initialization.runtime.backend).toBe('wasm');
    expect(pipeline.snapshot()).toMatchObject({
      state: 'ready',
      artifactSource: 'cache',
      cachePersisted: true,
      backend: 'wasm',
    });

    await pipeline.dispose();
    expect(detector.disposeCalls).toBe(1);
    expect(pipeline.snapshot()).toEqual({ state: 'disposed' });
  });

  it('processes semantic frames locally without inventing a counting line', async () => {
    const detector = new FakeDetector();
    const pipeline = new NanoDetPilotPipeline({
      sessionId: 'session_test',
      loader: async () => loaded(detector),
    });

    const frame = await pipeline.process({
      source: {} as CanvasImageSource,
      sourceWidth: 640,
      sourceHeight: 360,
      timestampMs: 1_788_000_000_000,
    });

    expect(detector.detectCalls).toBe(1);
    expect(frame.detector.detections).toHaveLength(1);
    expect(frame.fusion.entities).toHaveLength(1);
    expect(frame.crossings).toEqual([]);
    await pipeline.dispose();
  });

  it('records loader failures as an explicit pilot error and remains retry-safe only via a new instance', async () => {
    const pipeline = new NanoDetPilotPipeline({
      loader: async () => {
        throw new Error('pilot download failed');
      },
    });

    await expect(pipeline.initialize()).rejects.toThrow('pilot download failed');
    expect(pipeline.snapshot()).toEqual({
      state: 'error',
      error: 'pilot download failed',
    });
    await pipeline.dispose();
  });
});
