export type NodePerformanceProfile = 'eco' | 'balanced' | 'performance';

export interface DeviceCapabilityHints {
  hardwareConcurrency: number;
  deviceMemoryGiB?: number;
  webgpu: boolean;
}

export interface RuntimePerformanceSnapshot {
  observedFps: number;
  processingLatencyP95Ms: number;
  droppedFrameRatio: number;
}

export interface NodeProfileSettings {
  profile: NodePerformanceProfile;
  captureWidth: number;
  captureHeight: number;
  captureFps: number;
  inferenceFps: number;
  maxDetections: number;
}

export const NODE_PROFILE_SETTINGS: Record<NodePerformanceProfile, NodeProfileSettings> = {
  eco: {
    profile: 'eco',
    captureWidth: 640,
    captureHeight: 360,
    captureFps: 15,
    inferenceFps: 2.5,
    maxDetections: 60,
  },
  balanced: {
    profile: 'balanced',
    captureWidth: 960,
    captureHeight: 540,
    captureFps: 24,
    inferenceFps: 5,
    maxDetections: 100,
  },
  performance: {
    profile: 'performance',
    captureWidth: 1280,
    captureHeight: 720,
    captureFps: 30,
    inferenceFps: 10,
    maxDetections: 160,
  },
};

function navigatorDeviceMemory(): number | undefined {
  const candidate = navigator as Navigator & { deviceMemory?: number };
  return typeof candidate.deviceMemory === 'number' && Number.isFinite(candidate.deviceMemory)
    ? candidate.deviceMemory
    : undefined;
}

export function detectDeviceCapabilityHints(): DeviceCapabilityHints {
  const hardwareConcurrency = Number.isFinite(navigator.hardwareConcurrency)
    ? Math.max(1, navigator.hardwareConcurrency)
    : 2;
  const deviceMemoryGiB = navigatorDeviceMemory();
  const webgpu = 'gpu' in navigator;

  return {
    hardwareConcurrency,
    ...(deviceMemoryGiB === undefined ? {} : { deviceMemoryGiB }),
    webgpu,
  };
}

/**
 * Conservative initial selection. Runtime evidence can always step the node
 * down later; capability hints are never treated as measurements of actual
 * sustained inference performance.
 */
export function chooseInitialNodeProfile(
  hints: DeviceCapabilityHints,
): NodePerformanceProfile {
  if (hints.hardwareConcurrency <= 4 || (hints.deviceMemoryGiB !== undefined && hints.deviceMemoryGiB <= 3)) {
    return 'eco';
  }
  if (
    hints.webgpu
    && hints.hardwareConcurrency >= 8
    && (hints.deviceMemoryGiB === undefined || hints.deviceMemoryGiB >= 6)
  ) {
    return 'performance';
  }
  return 'balanced';
}

function profileIndex(profile: NodePerformanceProfile): number {
  return profile === 'eco' ? 0 : profile === 'balanced' ? 1 : 2;
}

function profileAt(index: number): NodePerformanceProfile {
  if (index <= 0) return 'eco';
  if (index >= 2) return 'performance';
  return 'balanced';
}

export interface AdaptationDecision {
  profile: NodePerformanceProfile;
  changed: boolean;
  reason:
    | 'initial'
    | 'runtime_overload'
    | 'runtime_healthy'
    | 'hold';
}

export interface ProfileAdaptationOptions {
  overloadWindowsToStepDown?: number;
  healthyWindowsToStepUp?: number;
}

/**
 * Stateful hysteresis controller. It reacts to measured inference health,
 * not phone model names. This makes old/unknown devices first-class citizens.
 */
export class AdaptiveNodeProfileController {
  private profile: NodePerformanceProfile;
  private overloadWindows = 0;
  private healthyWindows = 0;
  private readonly overloadWindowsToStepDown: number;
  private readonly healthyWindowsToStepUp: number;

  constructor(
    initialProfile: NodePerformanceProfile,
    options: ProfileAdaptationOptions = {},
  ) {
    this.profile = initialProfile;
    this.overloadWindowsToStepDown = Math.max(1, options.overloadWindowsToStepDown ?? 2);
    this.healthyWindowsToStepUp = Math.max(2, options.healthyWindowsToStepUp ?? 6);
  }

  current(): NodePerformanceProfile {
    return this.profile;
  }

  observe(snapshot: RuntimePerformanceSnapshot): AdaptationDecision {
    const settings = NODE_PROFILE_SETTINGS[this.profile];
    const frameBudgetMs = 1000 / settings.inferenceFps;
    const overload = (
      snapshot.processingLatencyP95Ms > frameBudgetMs * 1.35
      || snapshot.droppedFrameRatio > 0.18
      || snapshot.observedFps < settings.inferenceFps * 0.62
    );
    const healthy = (
      snapshot.processingLatencyP95Ms < frameBudgetMs * 0.65
      && snapshot.droppedFrameRatio < 0.04
      && snapshot.observedFps >= settings.inferenceFps * 0.9
    );

    if (overload) {
      this.overloadWindows += 1;
      this.healthyWindows = 0;
      if (this.overloadWindows >= this.overloadWindowsToStepDown && this.profile !== 'eco') {
        this.profile = profileAt(profileIndex(this.profile) - 1);
        this.overloadWindows = 0;
        return { profile: this.profile, changed: true, reason: 'runtime_overload' };
      }
      return { profile: this.profile, changed: false, reason: 'hold' };
    }

    if (healthy) {
      this.healthyWindows += 1;
      this.overloadWindows = 0;
      if (this.healthyWindows >= this.healthyWindowsToStepUp && this.profile !== 'performance') {
        this.profile = profileAt(profileIndex(this.profile) + 1);
        this.healthyWindows = 0;
        return { profile: this.profile, changed: true, reason: 'runtime_healthy' };
      }
      return { profile: this.profile, changed: false, reason: 'hold' };
    }

    this.overloadWindows = 0;
    this.healthyWindows = 0;
    return { profile: this.profile, changed: false, reason: 'hold' };
  }
}
