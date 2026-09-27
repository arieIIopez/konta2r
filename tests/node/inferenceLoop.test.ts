import { describe, expect, it } from 'vitest';
import {
  NodeInferenceLoop,
  type InferenceFrameProcessor,
} from '../../src/node/inferenceLoop';

class DelayedProcessor implements InferenceFrameProcessor<{ ok: true }> {
  initializeCount = 0;
  disposeCount = 0;
  private resolveInitialization: (() => void) | null = null;
  private readonly pending = new Promise<void>((resolve) => {
    this.resolveInitialization = resolve;
  });

  async initialize(): Promise<void> {
    this.initializeCount += 1;
    await this.pending;
  }

  resolve(): void {
    this.resolveInitialization?.();
  }

  async process(): Promise<{ ok: true }> {
    return { ok: true };
  }

  dispose(): void {
    this.disposeCount += 1;
  }
}

const video = {} as HTMLVideoElement;

describe('NodeInferenceLoop initialization lifecycle', () => {
  it('does not initialize the processor twice during rapid camera reconfiguration', async () => {
    const processor = new DelayedProcessor();
    const loop = new NodeInferenceLoop(processor);

    const firstStart = loop.start(video);
    expect(processor.initializeCount).toBe(1);

    loop.stop();
    const secondStart = loop.start(video);
    expect(processor.initializeCount).toBe(1);

    loop.stop();
    processor.resolve();
    await Promise.all([firstStart, secondStart]);

    expect(processor.initializeCount).toBe(1);
    expect(loop.currentState()).toBe('stopped');

    await loop.dispose();
    expect(processor.disposeCount).toBe(1);
    expect(loop.currentState()).toBe('idle');
  });
});
