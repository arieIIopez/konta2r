import { describe, expect, it } from 'vitest';
import { cameraConstraintsForProfile } from '../../src/node/camera';

function videoConstraints(profile: 'eco' | 'balanced' | 'performance'): MediaTrackConstraints {
  const constraints = cameraConstraintsForProfile(profile).video;
  if (!constraints || constraints === true) throw new Error('Expected explicit video constraints');
  return constraints;
}

describe('node camera profiles', () => {
  it('keeps audio disabled and prefers the environment camera', () => {
    const constraints = cameraConstraintsForProfile('balanced');
    expect(constraints.audio).toBe(false);
    expect(videoConstraints('balanced').facingMode).toEqual({ ideal: 'environment' });
  });

  it('scales capture demand with the node performance profile', () => {
    const eco = videoConstraints('eco');
    const balanced = videoConstraints('balanced');
    const performance = videoConstraints('performance');

    expect(eco.width).toEqual({ ideal: 640 });
    expect(balanced.width).toEqual({ ideal: 960 });
    expect(performance.width).toEqual({ ideal: 1280 });
    expect(eco.frameRate).toEqual({ ideal: 15, max: 15 });
    expect(performance.frameRate).toEqual({ ideal: 30, max: 30 });
  });
});
