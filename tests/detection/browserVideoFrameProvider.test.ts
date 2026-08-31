import { describe, expect, it } from 'vitest';
import type { AnnotatedBenchmarkFrame } from '../../src/detection/benchmarkDataset';
import { BrowserVideoBenchmarkFrameProvider } from '../../src/detection/browserVideoFrameProvider';

function fakeVideo(width = 640, height = 360): HTMLVideoElement {
  return { videoWidth: width, videoHeight: height } as HTMLVideoElement;
}

const frame: AnnotatedBenchmarkFrame = {
  frameId: 'f1',
  timestampMs: 10_000,
  mediaTimeMs: 1_000,
  width: 640,
  height: 360,
  objects: [],
};

describe('browser video benchmark frame provider', () => {
  it('reuses the video element and exposes presented media time without copying the frame', async () => {
    const video = fakeVideo();
    const provider = new BrowserVideoBenchmarkFrameProvider(video, {
      seek: async (_video, target) => ({
        currentTimeMs: target,
        presentedMediaTimeMs: target + 5,
      }),
      seekToleranceMs: 10,
      requirePresentedFrameTime: true,
    });

    const materialized = await provider.materialize(frame);
    expect(materialized.source).toBe(video);
    expect(materialized.actualMediaTimeMs).toBe(1005);
    expect(materialized.release).toBeUndefined();
  });

  it('requires a distinct mediaTimeMs instead of treating logical timestamp as seek time', async () => {
    const video = fakeVideo();
    let seekCalled = false;
    const provider = new BrowserVideoBenchmarkFrameProvider(video, {
      seek: async () => {
        seekCalled = true;
        return { currentTimeMs: 0 };
      },
    });
    const { mediaTimeMs: _omitted, ...frameWithoutMediaTime } = frame;

    await expect(provider.materialize(frameWithoutMediaTime))
      .rejects.toThrow('requires mediaTimeMs');
    expect(seekCalled).toBe(false);
  });

  it('rejects annotation dimensions that differ from the source video', async () => {
    const provider = new BrowserVideoBenchmarkFrameProvider(fakeVideo(1280, 720), {
      seek: async (_video, target) => ({ currentTimeMs: target, presentedMediaTimeMs: target }),
    });

    await expect(provider.materialize(frame)).rejects.toThrow('do not match annotation');
  });

  it('rejects a presented frame outside the configured seek tolerance', async () => {
    const provider = new BrowserVideoBenchmarkFrameProvider(fakeVideo(), {
      seekToleranceMs: 20,
      seek: async (_video, target) => ({ currentTimeMs: target, presentedMediaTimeMs: target + 35 }),
    });

    await expect(provider.materialize(frame)).rejects.toThrow('exceeds tolerance');
  });

  it('can require presented-frame timing evidence in strict mode', async () => {
    const provider = new BrowserVideoBenchmarkFrameProvider(fakeVideo(), {
      requirePresentedFrameTime: true,
      seek: async (_video, target) => ({ currentTimeMs: target }),
    });

    await expect(provider.materialize(frame)).rejects.toThrow('strict benchmark mode');
  });
});
