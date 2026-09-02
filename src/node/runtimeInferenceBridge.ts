import { NODE_PROFILE_SETTINGS } from './deviceProfile';
import {
  NodeInferenceLoop,
  type InferenceFrameProcessor,
  type InferenceLoopState,
} from './inferenceLoop';
import type { NodeRuntimeListener, NodeRuntimeSnapshot } from './runtimeController';

export interface RuntimeInferenceHost {
  subscribe(listener: NodeRuntimeListener): () => void;
  recordInferenceSample(processingMs: number, timestampMs?: number): void;
}

export interface RuntimeInferenceDecision {
  enabled: boolean;
  targetFps: number;
}

export interface RuntimeInferenceBridgeOptions<TFrame> {
  maxConsecutiveErrors?: number;
  processWhenHidden?: boolean;
  onFrame?: (frame: TFrame) => void;
  onError?: (error: Error, consecutiveErrors: number) => void;
  onStateChange?: (state: InferenceLoopState) => void;
}

/**
 * Pure policy used by the bridge and unit tests. Inference is permitted only
 * while the runtime says the camera is live and no camera/storage/profile
 * transition is in progress.
 */
export function deriveRuntimeInferenceDecision(
  snapshot: NodeRuntimeSnapshot,
  hasVideo: boolean,
): RuntimeInferenceDecision {
  return {
    enabled: hasVideo && snapshot.running && !snapshot.busy && snapshot.camera.active,
    targetFps: NODE_PROFILE_SETTINGS[snapshot.profile].inferenceFps,
  };
}

/**
 * Couples the operational node runtime to the semantic edge pipeline without
 * letting either layer own the other. Camera/profile state controls scheduling;
 * processing measurements flow back to NodeHealthMonitor through the runtime.
 */
export class RuntimeInferenceBridge<TFrame> {
  private readonly runtime: RuntimeInferenceHost;
  private readonly loop: NodeInferenceLoop<TFrame>;
  private readonly unsubscribe: () => void;
  private video: HTMLVideoElement | null = null;
  private latestSnapshot: NodeRuntimeSnapshot | null = null;
  private inferenceDesired = false;
  private disposed = false;

  constructor(
    runtime: RuntimeInferenceHost,
    processor: InferenceFrameProcessor<TFrame>,
    options: RuntimeInferenceBridgeOptions<TFrame> = {},
  ) {
    this.runtime = runtime;
    this.loop = new NodeInferenceLoop(processor, {
      targetFps: NODE_PROFILE_SETTINGS.balanced.inferenceFps,
      ...(options.maxConsecutiveErrors === undefined
        ? {}
        : { maxConsecutiveErrors: options.maxConsecutiveErrors }),
      ...(options.processWhenHidden === undefined
        ? {}
        : { processWhenHidden: options.processWhenHidden }),
      onFrame: (frame) => options.onFrame?.(frame),
      onProcessingSample: (processingMs, monotonicTimestampMs) => {
        this.runtime.recordInferenceSample(processingMs, monotonicTimestampMs);
      },
      onError: (error, consecutiveErrors) => options.onError?.(error, consecutiveErrors),
      onStateChange: (state) => options.onStateChange?.(state),
    });
    this.unsubscribe = runtime.subscribe((snapshot) => this.handleRuntimeSnapshot(snapshot));
  }

  attachVideo(video: HTMLVideoElement): void {
    if (this.disposed) throw new Error('RuntimeInferenceBridge is disposed');
    this.video = video;
    this.reconcile();
  }

  detachVideo(): void {
    this.video = null;
    this.reconcile();
  }

  currentState(): InferenceLoopState {
    return this.loop.currentState();
  }

  currentTargetFps(): number {
    return this.loop.currentTargetFps();
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    this.video = null;
    this.inferenceDesired = false;
    await this.loop.dispose();
  }

  private handleRuntimeSnapshot(snapshot: NodeRuntimeSnapshot): void {
    if (this.disposed) return;
    this.latestSnapshot = snapshot;
    this.reconcile();
  }

  private reconcile(): void {
    const snapshot = this.latestSnapshot;
    if (!snapshot || this.disposed) return;

    const decision = deriveRuntimeInferenceDecision(snapshot, this.video !== null);
    this.loop.setTargetFps(decision.targetFps);

    if (decision.enabled === this.inferenceDesired) return;
    this.inferenceDesired = decision.enabled;

    if (decision.enabled && this.video) {
      void this.loop.start(this.video);
    } else {
      this.loop.stop();
    }
  }
}
