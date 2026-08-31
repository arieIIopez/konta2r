import type { DetectorInput } from '../detection/types';

export type InferenceLoopState = 'idle' | 'initializing' | 'running' | 'stopped' | 'error';

export interface InferenceFrameProcessor<TFrame> {
  initialize(): Promise<unknown>;
  process(input: DetectorInput): Promise<TFrame>;
  dispose(): Promise<void> | void;
}

export interface NodeInferenceLoopOptions<TFrame> {
  targetFps?: number;
  maxConsecutiveErrors?: number;
  processWhenHidden?: boolean;
  onFrame?: (frame: TFrame) => void;
  onProcessingSample?: (processingMs: number, monotonicTimestampMs: number) => void;
  onError?: (error: Error, consecutiveErrors: number) => void;
  onStateChange?: (state: InferenceLoopState) => void;
}

function normalizeTargetFps(value: number): number {
  if (!Number.isFinite(value)) throw new Error('Inference target FPS must be finite');
  return Math.min(30, Math.max(0.5, value));
}

/**
 * Schedules edge inference at a target frequency without ever overlapping two
 * processor calls. When processing takes longer than the frame budget, the next
 * iteration starts only after the previous one completes; downstream health
 * monitoring can then downgrade the node profile.
 */
export class NodeInferenceLoop<TFrame> {
  private readonly processor: InferenceFrameProcessor<TFrame>;
  private readonly maxConsecutiveErrors: number;
  private readonly processWhenHidden: boolean;
  private readonly onFrame: ((frame: TFrame) => void) | undefined;
  private readonly onProcessingSample:
    | ((processingMs: number, monotonicTimestampMs: number) => void)
    | undefined;
  private readonly onError: ((error: Error, consecutiveErrors: number) => void) | undefined;
  private readonly onStateChange: ((state: InferenceLoopState) => void) | undefined;
  private targetFps: number;
  private state: InferenceLoopState = 'idle';
  private video: HTMLVideoElement | null = null;
  private timerId: number | null = null;
  private runToken = 0;
  private consecutiveErrors = 0;

  constructor(
    processor: InferenceFrameProcessor<TFrame>,
    options: NodeInferenceLoopOptions<TFrame> = {},
  ) {
    this.processor = processor;
    this.targetFps = normalizeTargetFps(options.targetFps ?? 5);
    this.maxConsecutiveErrors = Math.max(1, Math.floor(options.maxConsecutiveErrors ?? 3));
    this.processWhenHidden = options.processWhenHidden ?? false;
    this.onFrame = options.onFrame;
    this.onProcessingSample = options.onProcessingSample;
    this.onError = options.onError;
    this.onStateChange = options.onStateChange;
  }

  currentState(): InferenceLoopState {
    return this.state;
  }

  currentTargetFps(): number {
    return this.targetFps;
  }

  setTargetFps(targetFps: number): void {
    this.targetFps = normalizeTargetFps(targetFps);
  }

  async start(video: HTMLVideoElement): Promise<void> {
    if (this.state === 'running' || this.state === 'initializing') return;
    this.stopTimer();
    this.video = video;
    this.consecutiveErrors = 0;
    const token = ++this.runToken;
    this.setState('initializing');

    try {
      await this.processor.initialize();
      if (token !== this.runToken) return;
      this.setState('running');
      this.schedule(0, token);
    } catch (error) {
      if (token !== this.runToken) return;
      const normalized = error instanceof Error ? error : new Error('processor_initialization_failed');
      this.setState('error');
      this.onError?.(normalized, 1);
    }
  }

  stop(): void {
    this.runToken += 1;
    this.stopTimer();
    this.video = null;
    this.consecutiveErrors = 0;
    if (this.state !== 'idle') this.setState('stopped');
  }

  async dispose(): Promise<void> {
    this.stop();
    await this.processor.dispose();
    this.setState('idle');
  }

  private schedule(delayMs: number, token: number): void {
    this.stopTimer();
    if (token !== this.runToken || this.state !== 'running') return;
    this.timerId = window.setTimeout(() => void this.tick(token), Math.max(0, delayMs));
  }

  private async tick(token: number): Promise<void> {
    if (token !== this.runToken || this.state !== 'running') return;
    const video = this.video;
    const intervalMs = 1000 / this.targetFps;

    if (!video) {
      this.schedule(intervalMs, token);
      return;
    }
    if (!this.processWhenHidden && document.visibilityState !== 'visible') {
      this.schedule(intervalMs, token);
      return;
    }
    if (video.readyState < 2 || !(video.videoWidth > 0) || !(video.videoHeight > 0)) {
      this.schedule(intervalMs, token);
      return;
    }

    const monotonicStart = performance.now();
    try {
      const frame = await this.processor.process({
        source: video,
        sourceWidth: video.videoWidth,
        sourceHeight: video.videoHeight,
        timestampMs: Date.now(),
      });
      const monotonicEnd = performance.now();
      if (token !== this.runToken || this.state !== 'running') return;

      this.consecutiveErrors = 0;
      const processingMs = Math.max(0, monotonicEnd - monotonicStart);
      this.onProcessingSample?.(processingMs, monotonicEnd);
      this.onFrame?.(frame);
      this.schedule(Math.max(0, intervalMs - processingMs), token);
    } catch (error) {
      if (token !== this.runToken || this.state !== 'running') return;
      this.consecutiveErrors += 1;
      const normalized = error instanceof Error ? error : new Error('inference_failed');
      this.onError?.(normalized, this.consecutiveErrors);

      if (this.consecutiveErrors >= this.maxConsecutiveErrors) {
        this.stopTimer();
        this.setState('error');
        return;
      }
      this.schedule(intervalMs, token);
    }
  }

  private stopTimer(): void {
    if (this.timerId !== null) {
      window.clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  private setState(state: InferenceLoopState): void {
    if (state === this.state) return;
    this.state = state;
    this.onStateChange?.(state);
  }
}

export const normalizeInferenceTargetFps = normalizeTargetFps;
