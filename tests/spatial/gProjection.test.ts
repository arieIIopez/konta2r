import { describe, expect, it } from 'vitest';
import {
  applyHomography,
  distortPixel,
  groundToImage,
  imageToGround,
  imageToMetricGround,
  invertMatrix3,
  parallaxCorrectGroundToReal,
  undistortPixel,
} from '../../src/spatial/gProjection';
import type { SpatialCalibration } from '../../src/spatial/types';

const identityCalibration: SpatialCalibration = {
  id: 'test',
  imageWidth: 1280,
  imageHeight: 720,
  imageToGroundH: [
    1, 0, 0,
    0, 1, 0,
    0, 0, 1,
  ],
  cameraGroundPoint: { x: 0, y: 0 },
  cameraHeightMeters: 10,
  groundUnitsPerMeter: 10,
  calibrationQuality: 1,
  createdAtIso: '2026-08-30T00:00:00.000Z',
  status: 'valid',
};

describe('gProjection', () => {
  it('applies and inverts a homography', () => {
    const h = [
      2, 0, 10,
      0, 3, 20,
      0, 0, 1,
    ] as const;

    const source = { x: 5, y: 7 };
    const projected = applyHomography(source, h);
    expect(projected.x).toBeCloseTo(20);
    expect(projected.y).toBeCloseTo(41);

    const restored = applyHomography(projected, invertMatrix3(h));
    expect(restored.x).toBeCloseTo(source.x);
    expect(restored.y).toBeCloseTo(source.y);
  });

  it('round-trips image and ground coordinates without distortion', () => {
    const source = { x: 320, y: 240 };
    const ground = imageToGround(source, identityCalibration);
    const restored = groundToImage(ground, identityCalibration);

    expect(restored.x).toBeCloseTo(source.x);
    expect(restored.y).toBeCloseTo(source.y);
  });

  it('converts ground units to meters explicitly', () => {
    const metric = imageToMetricGround({ x: 120, y: 30 }, identityCalibration);
    expect(metric.xMeters).toBeCloseTo(12);
    expect(metric.yMeters).toBeCloseTo(3);
  });

  it('applies TrafficLab-style parallax correction toward the camera ground point', () => {
    const corrected = parallaxCorrectGroundToReal(
      { x: 100, y: 50 },
      2,
      { x: 0, y: 0 },
      10,
    );

    expect(corrected.x).toBeCloseTo(80);
    expect(corrected.y).toBeCloseTo(40);
  });

  it('approximately inverts Brown-Conrady distortion', () => {
    const intrinsics = { fx: 900, fy: 900, cx: 640, cy: 360 };
    const distortion = { k1: -0.12, k2: 0.02, p1: 0.001, p2: -0.001, k3: 0.0 };
    const undistorted = { x: 900, y: 500 };

    const distorted = distortPixel(undistorted, intrinsics, distortion);
    const recovered = undistortPixel(distorted, intrinsics, distortion, 12);

    expect(recovered.x).toBeCloseTo(undistorted.x, 3);
    expect(recovered.y).toBeCloseTo(undistorted.y, 3);
  });

  it('rejects stale calibration for metric reconstruction', () => {
    const stale: SpatialCalibration = { ...identityCalibration, status: 'stale' };
    expect(() => imageToGround({ x: 1, y: 2 }, stale)).toThrow(/stale/);
  });
});
