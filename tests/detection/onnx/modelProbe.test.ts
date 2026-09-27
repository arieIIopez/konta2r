import { describe, expect, it } from 'vitest';
import { probeOnnxModel } from '../../../src/detection/onnx/modelProbe';
import type {
  OnnxExecutionProvider,
  OnnxModelSource,
  OnnxSessionFactory,
  OnnxSessionLike,
  OnnxValueMetadata,
} from '../../../src/detection/onnx/runtime';

class ProbeSession implements OnnxSessionLike {
  releaseCount = 0;
  readonly inputNames = ['image_tensor'];
  readonly outputNames = ['boxes', 'scores'];
  readonly inputMetadata: OnnxValueMetadata[] = [
    { name: 'image_tensor', kind: 'tensor', type: 'uint8', shape: [1, 300, 300, 3] },
  ];
  readonly outputMetadata: OnnxValueMetadata[] = [
    { name: 'boxes', kind: 'tensor', type: 'float32', shape: [1, 'N', 4] },
    { name: 'scores', kind: 'tensor', type: 'float32', shape: [1, 'N'] },
  ];

  async run(): Promise<Record<string, unknown>> {
    return {};
  }

  release(): void {
    this.releaseCount += 1;
  }
}

class ProbeFactory implements OnnxSessionFactory {
  readonly session = new ProbeSession();

  async create(
    _source: OnnxModelSource,
    _executionProviders: readonly OnnxExecutionProvider[],
  ): Promise<OnnxSessionLike> {
    return this.session;
  }
}

class NamesOnlySession implements OnnxSessionLike {
  releaseCount = 0;
  readonly inputNames = ['input'];
  readonly outputNames = ['output'];

  async run(): Promise<Record<string, unknown>> {
    return {};
  }

  release(): void {
    this.releaseCount += 1;
  }
}

class NamesOnlyFactory implements OnnxSessionFactory {
  readonly session = new NamesOnlySession();

  async create(): Promise<OnnxSessionLike> {
    return this.session;
  }
}

describe('ONNX model probe', () => {
  it('returns runtime-declared tensor metadata and releases the temporary session', async () => {
    const factory = new ProbeFactory();
    const result = await probeOnnxModel('model.onnx', {
      capabilities: { webgpu: false },
      factory,
    });

    expect(result.runtime.backend).toBe('wasm');
    expect(result.inputs).toEqual([
      { name: 'image_tensor', kind: 'tensor', type: 'uint8', shape: [1, 300, 300, 3] },
    ]);
    expect(result.outputs[0]?.shape).toEqual([1, 'N', 4]);
    expect(factory.session.releaseCount).toBe(1);
  });

  it('falls back to names marked unknown when metadata is unavailable', async () => {
    const factory = new NamesOnlyFactory();
    const result = await probeOnnxModel('model.onnx', {
      capabilities: { webgpu: false },
      factory,
    });

    expect(result.inputs).toEqual([{ name: 'input', kind: 'unknown' }]);
    expect(result.outputs).toEqual([{ name: 'output', kind: 'unknown' }]);
    expect(factory.session.releaseCount).toBe(1);
  });
});
