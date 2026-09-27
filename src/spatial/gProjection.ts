import type { Point2D } from '../core/types';
import type {
  BrownConradyDistortion,
  CameraIntrinsics,
  Matrix3,
  MetricPoint2D,
  SpatialCalibration,
} from './types';

/**
 * Browser/edge adaptation of the geometric ideas used by TrafficLab-3D's
 * GProjection (MIT, Copyright (c) 2026 Yuk).
 *
 * This module intentionally contains no detector, tracker, video or identity
 * logic. It only converts geometry between image and local-ground domains.
 * See THIRD_PARTY_NOTICES.md.
 */

const EPSILON = 1e-9;

export function applyHomography(point: Point2D, h: Matrix3): Point2D {
  const denominator = h[6] * point.x + h[7] * point.y + h[8];
  if (Math.abs(denominator) < EPSILON) {
    throw new Error('Homography projects point to infinity');
  }

  return {
    x: (h[0] * point.x + h[1] * point.y + h[2]) / denominator,
    y: (h[3] * point.x + h[4] * point.y + h[5]) / denominator,
  };
}

export function invertMatrix3(m: Matrix3): Matrix3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const D = -(b * i - c * h);
  const E = a * i - c * g;
  const F = -(a * h - b * g);
  const G = b * f - c * e;
  const H = -(a * f - c * d);
  const I = a * e - b * d;
  const det = a * A + b * B + c * C;

  if (Math.abs(det) < EPSILON) {
    throw new Error('Homography matrix is singular');
  }

  const inv = 1 / det;
  return [
    A * inv, D * inv, G * inv,
    B * inv, E * inv, H * inv,
    C * inv, F * inv, I * inv,
  ];
}

function pixelToNormalized(point: Point2D, intrinsics: CameraIntrinsics): Point2D {
  return {
    x: (point.x - intrinsics.cx) / intrinsics.fx,
    y: (point.y - intrinsics.cy) / intrinsics.fy,
  };
}

function normalizedToPixel(point: Point2D, intrinsics: CameraIntrinsics): Point2D {
  return {
    x: point.x * intrinsics.fx + intrinsics.cx,
    y: point.y * intrinsics.fy + intrinsics.cy,
  };
}

export function distortNormalizedPoint(
  point: Point2D,
  distortion: BrownConradyDistortion,
): Point2D {
  const { x, y } = point;
  const r2 = x * x + y * y;
  const r4 = r2 * r2;
  const r6 = r4 * r2;
  const radial = 1 + distortion.k1 * r2 + distortion.k2 * r4 + distortion.k3 * r6;

  const tangentialX = 2 * distortion.p1 * x * y + distortion.p2 * (r2 + 2 * x * x);
  const tangentialY = distortion.p1 * (r2 + 2 * y * y) + 2 * distortion.p2 * x * y;

  return {
    x: x * radial + tangentialX,
    y: y * radial + tangentialY,
  };
}

/**
 * Iterative Brown-Conrady inversion suitable for calibration/reconstruction.
 * The result is an undistorted pixel expressed with the same intrinsics.
 */
export function undistortPixel(
  distortedPixel: Point2D,
  intrinsics: CameraIntrinsics,
  distortion: BrownConradyDistortion,
  iterations = 8,
): Point2D {
  const distorted = pixelToNormalized(distortedPixel, intrinsics);
  let x = distorted.x;
  let y = distorted.y;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const r2 = x * x + y * y;
    const r4 = r2 * r2;
    const r6 = r4 * r2;
    const radial = 1 + distortion.k1 * r2 + distortion.k2 * r4 + distortion.k3 * r6;

    if (Math.abs(radial) < EPSILON) {
      break;
    }

    const deltaX = 2 * distortion.p1 * x * y + distortion.p2 * (r2 + 2 * x * x);
    const deltaY = distortion.p1 * (r2 + 2 * y * y) + 2 * distortion.p2 * x * y;

    x = (distorted.x - deltaX) / radial;
    y = (distorted.y - deltaY) / radial;
  }

  return normalizedToPixel({ x, y }, intrinsics);
}

export function distortPixel(
  undistortedPixel: Point2D,
  intrinsics: CameraIntrinsics,
  distortion: BrownConradyDistortion,
): Point2D {
  const normalized = pixelToNormalized(undistortedPixel, intrinsics);
  return normalizedToPixel(distortNormalizedPoint(normalized, distortion), intrinsics);
}

/**
 * Corrects the apparent ground-plane point for parallax using a simplified
 * camera-height/object-height model, following TrafficLab-3D's GProjection.
 */
export function parallaxCorrectGroundToReal(
  apparentGroundPoint: Point2D,
  objectHeightMeters: number,
  cameraGroundPoint: Point2D,
  cameraHeightMeters: number,
): Point2D {
  if (cameraHeightMeters <= EPSILON || objectHeightMeters <= EPSILON) {
    return { ...apparentGroundPoint };
  }

  const safeHeight = Math.min(objectHeightMeters, cameraHeightMeters - 0.01);
  const factor = (cameraHeightMeters - safeHeight) / cameraHeightMeters;

  return {
    x: cameraGroundPoint.x + (apparentGroundPoint.x - cameraGroundPoint.x) * factor,
    y: cameraGroundPoint.y + (apparentGroundPoint.y - cameraGroundPoint.y) * factor,
  };
}

export function parallaxProjectRealToApparent(
  realGroundPoint: Point2D,
  objectHeightMeters: number,
  cameraGroundPoint: Point2D,
  cameraHeightMeters: number,
): Point2D {
  if (cameraHeightMeters <= EPSILON || objectHeightMeters <= EPSILON) {
    return { ...realGroundPoint };
  }

  const safeHeight = Math.min(objectHeightMeters, cameraHeightMeters - 0.01);
  const denominator = cameraHeightMeters - safeHeight;
  const factor = cameraHeightMeters / denominator;

  return {
    x: cameraGroundPoint.x + (realGroundPoint.x - cameraGroundPoint.x) * factor,
    y: cameraGroundPoint.y + (realGroundPoint.y - cameraGroundPoint.y) * factor,
  };
}

export function imageToGround(
  imagePoint: Point2D,
  calibration: SpatialCalibration,
  objectHeightMeters = 0,
): Point2D {
  if (calibration.status !== 'valid') {
    throw new Error(`Spatial calibration is ${calibration.status}`);
  }

  const undistorted = calibration.intrinsics && calibration.distortion
    ? undistortPixel(imagePoint, calibration.intrinsics, calibration.distortion)
    : imagePoint;

  const apparentGround = applyHomography(undistorted, calibration.imageToGroundH);

  return objectHeightMeters > 0
    ? parallaxCorrectGroundToReal(
        apparentGround,
        objectHeightMeters,
        calibration.cameraGroundPoint,
        calibration.cameraHeightMeters,
      )
    : apparentGround;
}

export function groundToImage(
  realGroundPoint: Point2D,
  calibration: SpatialCalibration,
  objectHeightMeters = 0,
): Point2D {
  if (calibration.status !== 'valid') {
    throw new Error(`Spatial calibration is ${calibration.status}`);
  }

  const apparentGround = objectHeightMeters > 0
    ? parallaxProjectRealToApparent(
        realGroundPoint,
        objectHeightMeters,
        calibration.cameraGroundPoint,
        calibration.cameraHeightMeters,
      )
    : realGroundPoint;

  const groundToImageH = invertMatrix3(calibration.imageToGroundH);
  const undistortedPixel = applyHomography(apparentGround, groundToImageH);

  return calibration.intrinsics && calibration.distortion
    ? distortPixel(undistortedPixel, calibration.intrinsics, calibration.distortion)
    : undistortedPixel;
}

export function groundToMetric(
  groundPoint: Point2D,
  calibration: SpatialCalibration,
): MetricPoint2D {
  if (calibration.groundUnitsPerMeter <= EPSILON) {
    throw new Error('groundUnitsPerMeter must be greater than zero');
  }

  return {
    xMeters: groundPoint.x / calibration.groundUnitsPerMeter,
    yMeters: groundPoint.y / calibration.groundUnitsPerMeter,
  };
}

export function imageToMetricGround(
  imagePoint: Point2D,
  calibration: SpatialCalibration,
  objectHeightMeters = 0,
): MetricPoint2D {
  return groundToMetric(imageToGround(imagePoint, calibration, objectHeightMeters), calibration);
}
