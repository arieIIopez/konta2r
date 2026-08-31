import type { AnnotatedBenchmarkFrame } from './benchmarkDataset';
import type { BenchmarkFrameProvider, MaterializedBenchmarkFrame } from './streamingBenchmark';

export interface BrowserVideoSeekResult {
  currentTimeMs: number;
  presentedMediaTimeMs?: number;
}

export type BrowserVideoSeek = (
  video: HTMLVideoElement,
  targetMediaTimeMs: number,
  timeoutMs: number,
) => Promise<BrowserVideoSeekResult>;

export interface BrowserVideoFrameProviderOptions {
  seekToleranceMs?: number;
  seekTimeoutMs?: number;
  requireDimensionMatch?: boolean;
  requirePresentedFrameTime?: boolean;
  seek?: BrowserVideoSeek;
}

function waitForEvent(
  target: EventTarget,
  eventName: string,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for video ${eventName}`));
    }, timeoutMs);
    const onEvent = (): void => {
      cleanup();
      resolve();
    };
    const onError = (): void => {
      cleanup();
      reject(new Error(`Video emitted an error while waiting for ${eventName}`));
    };
    const cleanup = (): void => {
      window.clearTimeout(timer);
      target.removeEventListener(eventName, onEvent);
      target.removeEventListener('error', onError);
    };
    target.addEventListener(eventName, onEvent, { once: true });
    target.addEventListener('error', onError, { once: true });
  });
}

async function ensureVideoMetadata(video: HTMLVideoElement, timeoutMs: number): Promise<void> {
  if (video.readyState >= 1 && video.videoWidth > 0 && video.videoHeight > 0) return;
  await waitForEvent(video, 'loadedmetadata', timeoutMs);
  if (!(video.videoWidth > 0) || !(video.videoHeight > 0)) {
    throw new Error('Video metadata loaded without valid dimensions');
  }
}

function requestPresentedFrameTime(
  video: HTMLVideoElement,
  timeoutMs: number,
): Promise<number> | null {
  if (typeof video.requestVideoFrameCallback !== 'function') return null;
  return new Promise((resolve, reject) => {
    let callbackId = -1;
    const timer = window.setTimeout(() => {
      if (callbackId >= 0 && typeof video.cancelVideoFrameCallback === 'function') {
        video.cancelVideoFrameCallback(callbackId);
      }
      reject(new Error('Timed out waiting for presented video frame'));
    }, timeoutMs);
    callbackId = video.requestVideoFrameCallback((_now, metadata) => {
      window.clearTimeout(timer);
      resolve(metadata.mediaTime * 1000);
    });
  });
}

/**
 * Seeks a paused local/browser video. requestVideoFrameCallback is registered
 * before the seek so its mediaTime describes the frame presented as a result of
 * that seek. currentTime is returned separately and is not treated as proof of
 * frame-level presentation accuracy.
 */
export async function seekHtmlVideoElement(
  video: HTMLVideoElement,
  targetMediaTimeMs: number,
  timeoutMs = 5_000,
): Promise<BrowserVideoSeekResult> {
  if (!Number.isFinite(targetMediaTimeMs) || targetMediaTimeMs < 0) {
    throw new Error('targetMediaTimeMs must be finite and non-negative');
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('seek timeout must be greater than zero');

  await ensureVideoMetadata(video, timeoutMs);
  video.pause();
  if (Number.isFinite(video.duration) && targetMediaTimeMs > video.duration * 1000 + 1) {
    throw new Error('Requested benchmark frame lies beyond video duration');
  }

  const targetSeconds = targetMediaTimeMs / 1000;
  if (Math.abs(video.currentTime - targetSeconds) < 0.0005 && video.readyState >= 2) {
    return { currentTimeMs: video.currentTime * 1000 };
  }

  const presentedPromise = requestPresentedFrameTime(video, timeoutMs);
  const seekedPromise = waitForEvent(video, 'seeked', timeoutMs);
  video.currentTime = targetSeconds;
  await seekedPromise;
  const currentTimeMs = video.currentTime * 1000;

  if (!presentedPromise) return { currentTimeMs };
  try {
    const presentedMediaTimeMs = await presentedPromise;
    return { currentTimeMs, presentedMediaTimeMs };
  } catch {
    return { currentTimeMs };
  }
}

/**
 * Reuses a single HTMLVideoElement as CanvasImageSource. No per-frame canvas or
 * ImageBitmap copy is created: the streaming runner guarantees that no next
 * seek occurs until Detector.detect() has resolved for the current frame.
 */
export class BrowserVideoBenchmarkFrameProvider implements BenchmarkFrameProvider {
  private readonly video: HTMLVideoElement;
  private readonly seekToleranceMs: number;
  private readonly seekTimeoutMs: number;
  private readonly requireDimensionMatch: boolean;
  private readonly requirePresentedFrameTime: boolean;
  private readonly seek: BrowserVideoSeek;

  constructor(video: HTMLVideoElement, options: BrowserVideoFrameProviderOptions = {}) {
    this.video = video;
    this.seekToleranceMs = Math.max(0, options.seekToleranceMs ?? 50);
    this.seekTimeoutMs = Math.max(250, options.seekTimeoutMs ?? 5_000);
    this.requireDimensionMatch = options.requireDimensionMatch ?? true;
    this.requirePresentedFrameTime = options.requirePresentedFrameTime ?? false;
    this.seek = options.seek ?? seekHtmlVideoElement;
  }

  async materialize(frame: AnnotatedBenchmarkFrame): Promise<MaterializedBenchmarkFrame> {
    if (frame.mediaTimeMs === undefined) {
      throw new Error(`Frame ${frame.frameId} requires mediaTimeMs for video materialization`);
    }

    const seekResult = await this.seek(this.video, frame.mediaTimeMs, this.seekTimeoutMs);
    if (this.requireDimensionMatch && (
      this.video.videoWidth !== frame.width || this.video.videoHeight !== frame.height
    )) {
      throw new Error(
        `Video dimensions ${this.video.videoWidth}x${this.video.videoHeight} do not match annotation ${frame.width}x${frame.height}`,
      );
    }

    const presentedMediaTimeMs = seekResult.presentedMediaTimeMs;
    if (presentedMediaTimeMs === undefined) {
      if (this.requirePresentedFrameTime) {
        throw new Error('Browser did not expose presented-frame mediaTime for strict benchmark mode');
      }
      return { source: this.video };
    }

    const seekErrorMs = Math.abs(presentedMediaTimeMs - frame.mediaTimeMs);
    if (seekErrorMs > this.seekToleranceMs) {
      throw new Error(
        `Presented frame seek error ${seekErrorMs.toFixed(2)} ms exceeds tolerance ${this.seekToleranceMs.toFixed(2)} ms`,
      );
    }
    return { source: this.video, actualMediaTimeMs: presentedMediaTimeMs };
  }
}
