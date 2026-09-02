import { describe, expect, it } from 'vitest';
import { applyHomography } from '../../src/spatial/gProjection';
import { fitHomography, fitRobustCalibration } from '../../src/spatial/calibration';

const correspondences = [
  { imagePoint: { x: 0, y: 0 }, groundPoint: { x: 10, y: 20 } },
  { imagePoint: { x: 100, y: 0 }, groundPoint: { x: 210, y: 20 } },
  { imagePoint: { x: 100, y: 100 }, groundPoint: { x: 210, y: 320 } },
  { imagePoint: { x: 0, y: 100 }, groundPoint: { x: 10, y: 320 } },
  { imagePoint: { x: 50, y: 50 }, groundPoint: { x: 110, y: 170 } },
];

describe('spatial calibration', () => {
  it('fits a known affine homography exactly', () => {
    const h = fitHomography(correspondences);
    const projected = applyHomography({ x: 25, y: 40 }, h);

    expect(projected.x).toBeCloseTo(60, 6);
    expect(projected.y).toBeCloseTo(140, 6);
  });

  it('reports metric reprojection error and high quality for a clean calibration', () => {
    const result = fitRobustCalibration(correspondences, {
      groundUnitsPerMeter: 10,
      inlierThresholdMeters: 0.2,
    });

    expect(result.status).toBe('valid');
    expect(result.inlierRatio).toBe(1);
    expect(result.reprojectionErrorMedianMeters).toBeLessThan(1e-6);
    expect(result.reprojectionErrorP95Meters).toBeLessThan(1e-6);
    expect(result.calibrationQuality).toBeGreaterThan(0.99);
  });

  it('rejects a grossly inconsistent control point as an outlier', () => {
    const contaminated = [
      ...correspondences,
      { imagePoint: { x: 75, y: 25 }, groundPoint: { x: 900, y: 900 } },
    ];

    const result = fitRobustCalibration(contaminated, {
      groundUnitsPerMeter: 10,
      inlierThresholdMeters: 0.5,
    });

    expect(result.status).toBe('valid');
    expect(result.inlierMask.filter(Boolean)).toHaveLength(5);
    expect(result.inlierMask.at(-1)).toBe(false);
    expect(result.inlierRatio).toBeCloseTo(5 / 6);
  });

  it('requires a valid metric scale', () => {
    expect(() => fitRobustCalibration(correspondences, { groundUnitsPerMeter: 0 })).toThrow(
      /greater than zero/,
    );
  });
});
