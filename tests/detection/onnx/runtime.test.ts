import { describe, expect, it } from 'vitest';
import {
  createOnnxSessionWithFallback,
  disposeOnnxValues,
  type OnnxExecutionProvider,
  type OnnxModelSource,
  type OnnxSessionFactory,
  type OnnxSessionLike,
} from '../../../src/detection/onnx/runtime';

class FakeSession implements OnnxSessionLike {
  released = false;

  async run(): Promise<Record<string, unknown>> {
    return {};
  }

  release(): void {
    this.released = true;
  }
}

class FakeFactory implements OnnxSessionFactory {
  readonly calls: OnnxExecutionProvider[][] = [];
  failWebGpu = false;

  async create(
    _source: OnnxModelSource,
    executionProviders: readonly OnnxExecutionProvider[],
  ): Promise<OnnxSessionLike> {
    this.calls.push([...executionProviders]);
    if (this.failWebGpu && executionProviders[0] === 'webgpu') {
      throw new Error('webgpu model unsupported');
    }
    return new FakeSession();
  }
}

describe('ONNX runtime selection', () => {
  it('prefers WebGPU with WASM fallback in the provider list when available', async () => {
    const factory = new FakeFactory();
    const selected = await createOnnxSessionWithFallback('model.onnx', {
      capabilities: { webgpu: true },
      factory,
    });

    expect(factory.calls).toEqual([['webgpu', 'wasm']]);
    expect(selected.runtime.backend).toBe('webgpu');
    expect(selected.webgpuAttempted).toBe(true);
  });

  it('retries session creation with WASM only after WebGPU creation fails', async () => {
    const factory = new FakeFactory();
    factory.failWebGpu = true;

    const selected = await createOnnxSessionWithFallback('model.onnx', {
      capabilities: { webgpu: true },
      factory,
    });

    expect(factory.calls).toEqual([['webgpu', 'wasm'], ['wasm']]);
    expect(selected.runtime.backend).toBe('wasm');
    expect(selected.fallbackReason).toContain('webgpu model unsupported');
  });

  it('uses WASM directly when WebGPU is unavailable', async () => {
    const factory = new FakeFactory();
    const selected = await createOnnxSessionWithFallback('model.onnx', {
      capabilities: { webgpu: false },
      factory,
    });

    expect(factory.calls).toEqual([['wasm']]);
    expect(selected.runtime.backend).toBe('wasm');
    expect(selected.webgpuAttempted).toBe(false);
  });

  it('disposes each unique output tensor once', async () => {
    let disposeCount = 0;
    const value = { dispose: () => { disposeCount += 1; } };
    await disposeOnnxValues({ a: value, alias: value, scalar: 1 });
    expect(disposeCount).toBe(1);
  });
});
