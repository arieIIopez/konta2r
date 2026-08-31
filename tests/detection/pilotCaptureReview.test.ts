import { describe, expect, it } from 'vitest';
import type { PilotCaptureRecord } from '../../src/detection/pilotCaptureRecord';
import { reviewPilotCaptureRecord } from '../../src/detection/pilotCaptureReview';

function base(): PilotCaptureRecord {
  return {
    schemaVersion: '1',
    recordType: 'konta2r_pilot_capture',
    captureId: 'cap-001',
    siteId: 'site-001',
    plannedSplit: 'development',
    startedAtIso: '2026-08-31T17:00:00.000Z',
    durationSeconds: 900,
    scene: {
      sceneType: 'mixed_traffic', lighting: 'day', viewAngle: 'medium_oblique',
      throughGlass: false, reflections: 'good', sceneOcclusion: 'good', cameraStability: 'good',
    },
    camera: {
      width: 960, height: 540, frameRate: 24,
      orientation: 'landscape', mount: 'fixed', facingMode: 'environment',
    },
    device: {
      profile: 'balanced', hardwareConcurrency: 8, deviceMemoryGiB: 6,
      webgpu: true, powerSource: 'mains',
    },
  };
}

describe('pilot capture review', () => {
  it('emits no automatic findings for a nominal balanced capture', () => {
    expect(reviewPilotCaptureRecord(base()).findings).toEqual([]);
  });

  it('surfaces difficult conditions without converting them into a validity score', () => {
    const value = base();
    value.scene.throughGlass = true;
    value.scene.reflections = 'poor';
    value.scene.sceneOcclusion = 'poor';
    value.scene.cameraStability = 'poor';
    value.camera.mount = 'handheld';
    const review = reviewPilotCaptureRecord(value);
    expect(review.findings.map((finding) => finding.code)).toEqual(expect.arrayContaining([
      'through_glass', 'strong_reflections', 'high_scene_occlusion', 'poor_camera_stability', 'handheld_capture',
    ]));
    expect('score' in review).toBe(false);
    expect('valid' in review).toBe(false);
  });

  it('describes a short low-spec battery capture separately from scene quality', () => {
    const value = base();
    value.durationSeconds = 120;
    value.camera.width = 320;
    value.camera.height = 180;
    value.camera.frameRate = 8;
    value.device.powerSource = 'battery';
    const codes = reviewPilotCaptureRecord(value).findings.map((finding) => finding.code);
    expect(codes).toEqual(expect.arrayContaining([
      'short_capture', 'low_resolution', 'low_frame_rate', 'profile_capture_below_target', 'battery_powered',
    ]));
  });
});
