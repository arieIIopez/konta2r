import { describe, expect, it } from 'vitest';
import type { NodeRuntimeSnapshot } from '../../src/node/runtimeController';
import { deriveRuntimeInferenceDecision } from '../../src/node/runtimeInferenceBridge';

function snapshot(
  profile: NodeRuntimeSnapshot['profile'],
  running: boolean,
  busy: boolean,
  cameraActive: boolean,
): NodeRuntimeSnapshot {
  return {
    running,
    busy,
    profile,
    hints: { hardwareConcurrency: 4, webgpu: false },
    camera: { active: cameraActive },
    wakeLock: { supported: false, desired: false, active: false },
    storage: null,
    health: {
      sampleCount: 0,
      observedFps: 0,
      processingLatencyP95Ms: 0,
      droppedFrameRatio: 0,
      latencyDriftRatio: 0,
      loadPressure: 'unknown',
    },
    continuity: {
      state: 'idle',
      elapsedMs: 0,
      activeMs: 0,
      uptimeRatio: 0,
      gapCount: 0,
      longestGapMs: 0,
    },
    online: true,
    secureContext: true,
  };
}

describe('runtime inference policy', () => {
  it('maps node profiles to their inference frequencies', () => {
    expect(deriveRuntimeInferenceDecision(snapshot('eco', true, false, true), true).targetFps).toBe(2.5);
    expect(deriveRuntimeInferenceDecision(snapshot('balanced', true, false, true), true).targetFps).toBe(5);
    expect(deriveRuntimeInferenceDecision(snapshot('performance', true, false, true), true).targetFps).toBe(10);
  });

  it('runs only with attached video, active camera and an idle runtime transition state', () => {
    expect(deriveRuntimeInferenceDecision(snapshot('balanced', true, false, true), true).enabled).toBe(true);
    expect(deriveRuntimeInferenceDecision(snapshot('balanced', true, true, true), true).enabled).toBe(false);
    expect(deriveRuntimeInferenceDecision(snapshot('balanced', true, false, false), true).enabled).toBe(false);
    expect(deriveRuntimeInferenceDecision(snapshot('balanced', false, false, true), true).enabled).toBe(false);
    expect(deriveRuntimeInferenceDecision(snapshot('balanced', true, false, true), false).enabled).toBe(false);
  });
});
