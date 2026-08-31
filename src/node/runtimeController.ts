import { NodeCameraController, type CameraRuntimeState } from './camera';
import {
  AdaptiveNodeProfileController,
  NODE_PROFILE_SETTINGS,
  chooseInitialNodeProfile,
  detectDeviceCapabilityHints,
  type DeviceCapabilityHints,
  type NodePerformanceProfile,
} from './deviceProfile';
import { NodeHealthMonitor, type NodeHealthSnapshot } from './healthMonitor';
import { inspectNodeStorage, type NodeStorageHealth } from './storageHealth';
import { ScreenWakeLockController, type WakeLockState } from './wakeLock';

export interface NodeRuntimeSnapshot {
  running: boolean;
  busy: boolean;
  profile: NodePerformanceProfile;
  hints: DeviceCapabilityHints;
  camera: CameraRuntimeState;
  wakeLock: WakeLockState;
  storage: NodeStorageHealth | null;
  health: NodeHealthSnapshot;
  online: boolean;
  secureContext: boolean;
  error?: string;
}

export type NodeRuntimeListener = (snapshot: NodeRuntimeSnapshot) => void;

type ProfileChangeSource = 'manual' | 'adaptive';

export class NodeRuntimeController {
  private readonly camera = new NodeCameraController();
  private readonly wakeLock = new ScreenWakeLockController();
  private readonly listeners = new Set<NodeRuntimeListener>();
  private readonly hints = detectDeviceCapabilityHints();
  private healthMonitor: NodeHealthMonitor;
  private profileController: AdaptiveNodeProfileController;
  private lastAdaptationEvaluationMs = 0;
  private video: HTMLVideoElement | null = null;
  private state: NodeRuntimeSnapshot;

  constructor() {
    const profile = chooseInitialNodeProfile(this.hints);
    this.healthMonitor = new NodeHealthMonitor({
      expectedFps: NODE_PROFILE_SETTINGS[profile].inferenceFps,
      windowMs: 60_000,
    });
    this.profileController = new AdaptiveNodeProfileController(profile);
    this.state = {
      running: false,
      busy: false,
      profile,
      hints: { ...this.hints },
      camera: { active: false },
      wakeLock: this.wakeLock.state(),
      storage: null,
      health: this.healthMonitor.snapshot(performance.now()),
      online: navigator.onLine,
      secureContext: window.isSecureContext,
    };
    window.addEventListener('online', this.connectivityHandler);
    window.addEventListener('offline', this.connectivityHandler);
  }

  subscribe(listener: NodeRuntimeListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  attachVideo(video: HTMLVideoElement): void {
    this.video = video;
  }

  snapshot(): NodeRuntimeSnapshot {
    return {
      ...this.state,
      hints: { ...this.state.hints },
      camera: { ...this.state.camera },
      wakeLock: { ...this.state.wakeLock },
      storage: this.state.storage ? { ...this.state.storage } : null,
      health: { ...this.state.health },
    };
  }

  /** Called by the detector loop after each completed inference. */
  recordInferenceSample(processingMs: number, timestampMs = performance.now()): void {
    this.healthMonitor.record({ timestampMs, processingMs });
    const health = this.healthMonitor.snapshot(timestampMs);
    this.state.health = health;
    this.emit();

    if (health.sampleCount < 10 || timestampMs - this.lastAdaptationEvaluationMs < 10_000) return;
    this.lastAdaptationEvaluationMs = timestampMs;
    const decision = this.profileController.observe({
      observedFps: health.observedFps,
      processingLatencyP95Ms: health.processingLatencyP95Ms,
      droppedFrameRatio: health.droppedFrameRatio,
    });
    if (decision.changed) void this.setProfile(decision.profile, 'adaptive');
  }

  async inspectStorage(requestPersistence = false): Promise<void> {
    this.state.storage = await inspectNodeStorage(requestPersistence);
    this.emit();
  }

  async start(): Promise<void> {
    if (this.state.busy || this.state.running) return;
    if (!this.video) throw new Error('Node video surface is not attached');
    if (!this.state.secureContext) throw new Error('A secure context is required to start the node');

    this.clearError();
    this.patch({ busy: true });
    try {
      this.state.camera = await this.camera.start(this.video, this.state.profile);
      this.state.wakeLock = await this.wakeLock.enable();
      this.state.storage = await inspectNodeStorage(true);
      this.patch({ running: true, busy: false });
    } catch (error) {
      await this.camera.stop();
      this.state.wakeLock = await this.wakeLock.disable();
      this.state.camera = { active: false };
      this.patch({
        running: false,
        busy: false,
        error: error instanceof Error ? error.message : 'node_start_failed',
      });
    }
  }

  async stop(): Promise<void> {
    if (this.state.busy) return;
    this.patch({ busy: true });
    await this.camera.stop();
    this.state.camera = { active: false };
    this.state.wakeLock = await this.wakeLock.disable();
    this.patch({ running: false, busy: false });
  }

  async setProfile(
    profile: NodePerformanceProfile,
    source: ProfileChangeSource = 'manual',
  ): Promise<void> {
    if (profile === this.state.profile) return;
    this.state.profile = profile;
    this.healthMonitor.setExpectedFps(NODE_PROFILE_SETTINGS[profile].inferenceFps);
    if (source === 'manual') this.profileController = new AdaptiveNodeProfileController(profile);
    this.emit();
    if (!this.state.running || !this.video) return;

    this.clearError();
    this.patch({ busy: true });
    try {
      this.state.camera = await this.camera.start(this.video, profile);
      this.patch({ busy: false });
    } catch (error) {
      this.state.camera = { active: false };
      this.patch({
        running: false,
        busy: false,
        error: error instanceof Error ? error.message : 'camera_reconfiguration_failed',
      });
    }
  }

  destroy(): void {
    window.removeEventListener('online', this.connectivityHandler);
    window.removeEventListener('offline', this.connectivityHandler);
    void this.camera.stop();
    this.wakeLock.destroy();
    this.listeners.clear();
  }

  private readonly connectivityHandler = (): void => {
    this.state.online = navigator.onLine;
    this.emit();
  };

  private clearError(): void {
    if ('error' in this.state) delete this.state.error;
  }

  private patch(values: Partial<NodeRuntimeSnapshot>): void {
    this.state = { ...this.state, ...values };
    this.emit();
  }

  private emit(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}
