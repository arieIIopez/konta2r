import { describe, expect, it } from 'vitest';
import type { CalibrationFitResult } from '../../src/spatial/calibration';
import { evaluateSpatialCapabilities } from '../../src/spatial/calibrationPolicy';

function calibration(overrides: Partial<CalibrationFitResult> = {}): CalibrationFitResult {
  return {
    imageToGroundH: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    inlierMask: [true, true, true, true, true, true],
    inlierRatio: 1,
    reprojectionErrorsMeters: [0.1, 0.12, 0.15, 0.18, 0.2, 0.25],
    reprojectionErrorMedianMeters: 0.15,
    reprojectionErrorP95Meters: 0.25,
    calibrationQuality: 0.96,
    status: 'valid',
    ...overrides,
  };
}

describe('spatial capability policy', () => {
  it('allows metric speed only when geometry, motion and camera stability are strong', () => {
    const report = evaluateSpatialCapabilities({
      calibration: calibration(),
      correspondenceCoverage: 0.92,
      trackingQuality: 0.94,
      motionQuality: 0.93,
      cameraStable: true,
    });

    expect(report.decisions.counting.enabled).toBe(true);
    expect(report.decisions.metric_position.enabled).toBe(true);
    expect(report.decisions.metric_speed.enabled).toBe(true);
    expect(report.decisions.advanced_interactions.enabled).toBe(true);
  });

  it('keeps counting but disables physical metrics when no calibration exists', () => {
    const report = evaluateSpatialCapabilities({
      trackingQuality: 0.9,
      motionQuality: 0.85,
    });

    expect(report.decisions.counting.enabled).toBe(true);
    expect(report.decisions.approximate_trajectory.enabled).toBe(true);
    expect(report.decisions.metric_position.enabled).toBe(false);
    expect(report.decisions.metric_speed.enabled).toBe(false);
    expect(report.decisions.metric_position.reasons).toContain('valid_metric_calibration_required');
  });

  it('invalidates metric outputs immediately when the camera has moved', () => {
    const report = evaluateSpatialCapabilities({
      calibration: calibration(),
      correspondenceCoverage: 0.9,
      trackingQuality: 0.95,
      motionQuality: 0.95,
      cameraStable: false,
    });

    expect(report.decisions.counting.enabled).toBe(true);
    expect(report.decisions.metric_position.enabled).toBe(false);
    expect(report.decisions.metric_speed.enabled).toBe(false);
    expect(report.decisions.metric_position.reasons).toContain('camera_moved_recalibration_required');
  });

  it('refuses speed when p95 geometric error is too large', () => {
    const report = evaluateSpatialCapabilities({
      calibration: calibration({
        reprojectionErrorP95Meters: 1.2,
        calibrationQuality: 0.9,
      }),
      correspondenceCoverage: 0.9,
      trackingQuality: 0.95,
      motionQuality: 0.95,
      cameraStable: true,
    });

    expect(report.decisions.metric_position.enabled).toBe(true);
    expect(report.decisions.metric_speed.enabled).toBe(false);
    expect(report.decisions.metric_speed.reasons).toContain('p95_reprojection_error_too_high_for_speed');
  });

  it('rejects metric position when calibration points are too clustered', () => {
    const report = evaluateSpatialCapabilities({
      calibration: calibration(),
      correspondenceCoverage: 0.2,
      trackingQuality: 0.95,
      motionQuality: 0.95,
      cameraStable: true,
    });

    expect(report.decisions.metric_position.enabled).toBe(false);
    expect(report.decisions.metric_position.reasons).toContain(
      'calibration_points_insufficiently_distributed',
    );
  });
});
