import { describe, expect, it } from 'vitest';
import {
  AdaptiveNodeProfileController,
  chooseInitialNodeProfile,
} from '../../src/node/deviceProfile';

describe('node device profiles', () => {
  it('starts conservatively on low-end capability hints', () => {
    expect(chooseInitialNodeProfile({ hardwareConcurrency: 4, deviceMemoryGiB: 2, webgpu: false })).toBe('eco');
  });

  it('allows performance profile only with strong hints and WebGPU', () => {
    expect(chooseInitialNodeProfile({ hardwareConcurrency: 8, deviceMemoryGiB: 8, webgpu: true })).toBe('performance');
    expect(chooseInitialNodeProfile({ hardwareConcurrency: 8, deviceMemoryGiB: 8, webgpu: false })).toBe('balanced');
  });

  it('steps down after sustained overload rather than one bad window', () => {
    const controller = new AdaptiveNodeProfileController('performance', {
      overloadWindowsToStepDown: 2,
      healthyWindowsToStepUp: 4,
    });
    const overload = { observedFps: 3, processingLatencyP95Ms: 180, droppedFrameRatio: 0.28 };

    expect(controller.observe(overload).changed).toBe(false);
    const second = controller.observe(overload);
    expect(second.changed).toBe(true);
    expect(second.profile).toBe('balanced');
  });

  it('requires longer sustained health before stepping up', () => {
    const controller = new AdaptiveNodeProfileController('eco', {
      overloadWindowsToStepDown: 2,
      healthyWindowsToStepUp: 3,
    });
    const healthy = { observedFps: 2.5, processingLatencyP95Ms: 40, droppedFrameRatio: 0.01 };

    expect(controller.observe(healthy).changed).toBe(false);
    expect(controller.observe(healthy).changed).toBe(false);
    const third = controller.observe(healthy);
    expect(third.changed).toBe(true);
    expect(third.profile).toBe('balanced');
  });
});
