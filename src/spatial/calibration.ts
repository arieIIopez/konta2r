import type { Point2D } from '../core/types';
import { applyHomography, invertMatrix3 } from './gProjection';
import type { Matrix3 } from './types';

const EPSILON = 1e-10;

export interface CalibrationCorrespondence {
  imagePoint: Point2D;
  groundPoint: Point2D;
}

export interface CalibrationFitOptions {
  groundUnitsPerMeter: number;
  inlierThresholdMeters?: number;
  maxHypotheses?: number;
}

export interface CalibrationFitResult {
  imageToGroundH: Matrix3;
  inlierMask: boolean[];
  inlierRatio: number;
  reprojectionErrorsMeters: number[];
  reprojectionErrorMedianMeters: number;
  reprojectionErrorP95Meters: number;
  calibrationQuality: number;
  status: 'valid' | 'invalid';
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function percentile(sortedValues: readonly number[], fraction: number): number {
  if (sortedValues.length === 0) {
    return Number.POSITIVE_INFINITY;
  }
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil(fraction * sortedValues.length) - 1),
  );
  return sortedValues[index] ?? Number.POSITIVE_INFINITY;
}

function solveLinearSystem(matrix: number[][], vector: number[]): number[] {
  const n = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index] ?? 0]);

  for (let pivot = 0; pivot < n; pivot += 1) {
    let bestRow = pivot;
    let bestMagnitude = Math.abs(augmented[pivot]?.[pivot] ?? 0);

    for (let row = pivot + 1; row < n; row += 1) {
      const magnitude = Math.abs(augmented[row]?.[pivot] ?? 0);
      if (magnitude > bestMagnitude) {
        bestMagnitude = magnitude;
        bestRow = row;
      }
    }

    if (bestMagnitude < EPSILON) {
      throw new Error('Calibration correspondences are degenerate');
    }

    if (bestRow !== pivot) {
      const temporary = augmented[pivot];
      const replacement = augmented[bestRow];
      if (!temporary || !replacement) {
        throw new Error('Calibration matrix row is unavailable');
      }
      augmented[pivot] = replacement;
      augmented[bestRow] = temporary;
    }

    const pivotRow = augmented[pivot];
    if (!pivotRow) {
      throw new Error('Calibration matrix pivot row is unavailable');
    }
    const pivotValue = pivotRow[pivot] ?? 0;
    for (let column = pivot; column <= n; column += 1) {
      pivotRow[column] = (pivotRow[column] ?? 0) / pivotValue;
    }

    for (let row = 0; row < n; row += 1) {
      if (row === pivot) continue;
      const targetRow = augmented[row];
      if (!targetRow) {
        throw new Error('Calibration matrix target row is unavailable');
      }
      const factor = targetRow[pivot] ?? 0;
      if (Math.abs(factor) < EPSILON) continue;
      for (let column = pivot; column <= n; column += 1) {
        targetRow[column] = (targetRow[column] ?? 0) - factor * (pivotRow[column] ?? 0);
      }
    }
  }

  return augmented.map((row) => row[n] ?? 0);
}

function multiplyMatrix3(a: Matrix3, b: Matrix3): Matrix3 {
  const result = Array<number>(9).fill(0);
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      let value = 0;
      for (let k = 0; k < 3; k += 1) {
        value += (a[row * 3 + k] ?? 0) * (b[k * 3 + column] ?? 0);
      }
      result[row * 3 + column] = value;
    }
  }
  return result as unknown as Matrix3;
}

interface PointNormalization {
  transform: Matrix3;
  points: Point2D[];
}

/** Hartley-style similarity normalization: centroid to origin, mean radius √2. */
function normalizePoints(points: readonly Point2D[]): PointNormalization {
  if (points.length === 0) {
    throw new Error('Cannot normalize an empty point set');
  }

  const centroid = points.reduce(
    (sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }),
    { x: 0, y: 0 },
  );
  centroid.x /= points.length;
  centroid.y /= points.length;

  const meanDistance = points.reduce(
    (sum, point) => sum + Math.hypot(point.x - centroid.x, point.y - centroid.y),
    0,
  ) / points.length;

  if (meanDistance < EPSILON) {
    throw new Error('Calibration points collapse to one location');
  }

  const scale = Math.SQRT2 / meanDistance;
  const transform: Matrix3 = [
    scale, 0, -scale * centroid.x,
    0, scale, -scale * centroid.y,
    0, 0, 1,
  ];

  return {
    transform,
    points: points.map((point) => applyHomography(point, transform)),
  };
}

/** Fits h33=1 after the input coordinates have already been normalized. */
function fitNormalizedHomography(
  correspondences: readonly CalibrationCorrespondence[],
): Matrix3 {
  const normal = Array.from({ length: 8 }, () => Array<number>(8).fill(0));
  const rhs = Array<number>(8).fill(0);

  const accumulate = (row: readonly number[], target: number): void => {
    for (let i = 0; i < 8; i += 1) {
      const ri = row[i] ?? 0;
      rhs[i] = (rhs[i] ?? 0) + ri * target;
      const normalRow = normal[i];
      if (!normalRow) throw new Error('Calibration normal matrix row is unavailable');
      for (let j = 0; j < 8; j += 1) {
        normalRow[j] = (normalRow[j] ?? 0) + ri * (row[j] ?? 0);
      }
    }
  };

  for (const correspondence of correspondences) {
    const x = correspondence.imagePoint.x;
    const y = correspondence.imagePoint.y;
    const u = correspondence.groundPoint.x;
    const v = correspondence.groundPoint.y;
    accumulate([x, y, 1, 0, 0, 0, -u * x, -u * y], u);
    accumulate([0, 0, 0, x, y, 1, -v * x, -v * y], v);
  }

  const h = solveLinearSystem(normal, rhs);
  return [
    h[0] ?? 0, h[1] ?? 0, h[2] ?? 0,
    h[3] ?? 0, h[4] ?? 0, h[5] ?? 0,
    h[6] ?? 0, h[7] ?? 0, 1,
  ];
}

/**
 * Numerically conditioned least-squares homography for small interactive
 * calibration sets. Both image and ground coordinates are similarity-normalized
 * before solving, then the homography is denormalized back to original units.
 */
export function fitHomography(correspondences: readonly CalibrationCorrespondence[]): Matrix3 {
  if (correspondences.length < 4) {
    throw new Error('At least four calibration correspondences are required');
  }

  const imageNormalization = normalizePoints(correspondences.map((item) => item.imagePoint));
  const groundNormalization = normalizePoints(correspondences.map((item) => item.groundPoint));

  const normalizedCorrespondences = correspondences.map((_, index) => {
    const imagePoint = imageNormalization.points[index];
    const groundPoint = groundNormalization.points[index];
    if (!imagePoint || !groundPoint) {
      throw new Error('Normalized calibration point is unavailable');
    }
    return { imagePoint, groundPoint };
  });

  const normalizedH = fitNormalizedHomography(normalizedCorrespondences);
  const denormalized = multiplyMatrix3(
    invertMatrix3(groundNormalization.transform),
    multiplyMatrix3(normalizedH, imageNormalization.transform),
  );

  const scale = denormalized[8] ?? 1;
  if (Math.abs(scale) < EPSILON) return denormalized;
  return denormalized.map((value) => value / scale) as unknown as Matrix3;
}

function errorMeters(
  correspondence: CalibrationCorrespondence,
  homography: Matrix3,
  groundUnitsPerMeter: number,
): number {
  const projected = applyHomography(correspondence.imagePoint, homography);
  return Math.hypot(
    projected.x - correspondence.groundPoint.x,
    projected.y - correspondence.groundPoint.y,
  ) / groundUnitsPerMeter;
}

function fourPointSubsets(count: number, maxHypotheses: number): number[][] {
  const subsets: number[][] = [];
  for (let a = 0; a < count - 3 && subsets.length < maxHypotheses; a += 1) {
    for (let b = a + 1; b < count - 2 && subsets.length < maxHypotheses; b += 1) {
      for (let c = b + 1; c < count - 1 && subsets.length < maxHypotheses; c += 1) {
        for (let d = c + 1; d < count && subsets.length < maxHypotheses; d += 1) {
          subsets.push([a, b, c, d]);
        }
      }
    }
  }
  return subsets;
}

/**
 * Deterministic small-sample RANSAC suitable for an assisted phone calibration.
 * Quality is intentionally decomposable: inlier ratio + median/p95 metric error.
 */
export function fitRobustCalibration(
  correspondences: readonly CalibrationCorrespondence[],
  options: CalibrationFitOptions,
): CalibrationFitResult {
  if (correspondences.length < 4) {
    throw new Error('At least four calibration correspondences are required');
  }
  if (!(options.groundUnitsPerMeter > 0)) {
    throw new Error('groundUnitsPerMeter must be greater than zero');
  }

  const threshold = options.inlierThresholdMeters ?? 0.75;
  const maxHypotheses = Math.max(1, options.maxHypotheses ?? 120);
  const hypotheses = correspondences.length === 4
    ? [[0, 1, 2, 3]]
    : fourPointSubsets(correspondences.length, maxHypotheses);

  let bestMask: boolean[] | null = null;
  let bestCount = -1;
  let bestMedian = Number.POSITIVE_INFINITY;

  for (const indices of hypotheses) {
    try {
      const sample = indices.map((index) => correspondences[index]).filter(
        (item): item is CalibrationCorrespondence => item !== undefined,
      );
      const homography = fitHomography(sample);
      const errors = correspondences.map((item) => errorMeters(
        item,
        homography,
        options.groundUnitsPerMeter,
      ));
      const mask = errors.map((error) => error <= threshold);
      const count = mask.filter(Boolean).length;
      const inlierErrors = errors.filter((_, index) => mask[index]).sort((a, b) => a - b);
      const median = percentile(inlierErrors, 0.5);

      if (count > bestCount || (count === bestCount && median < bestMedian)) {
        bestCount = count;
        bestMedian = median;
        bestMask = mask;
      }
    } catch {
      // Degenerate four-point hypotheses are expected and simply ignored.
    }
  }

  if (!bestMask || bestCount < 4) {
    throw new Error('Unable to obtain a valid homography from calibration points');
  }

  const inliers = correspondences.filter((_, index) => bestMask?.[index] === true);
  const refined = fitHomography(inliers);
  const errors = correspondences.map((item) => errorMeters(
    item,
    refined,
    options.groundUnitsPerMeter,
  ));
  const finalMask = errors.map((error) => error <= threshold);
  const inlierErrors = errors.filter((_, index) => finalMask[index]).sort((a, b) => a - b);
  const inlierRatio = inlierErrors.length / correspondences.length;
  const median = percentile(inlierErrors, 0.5);
  const p95 = percentile(inlierErrors, 0.95);

  const medianScore = Math.exp(-median / 0.35);
  const p95Score = Math.exp(-p95 / 0.8);
  const calibrationQuality = clamp01(
    0.45 * inlierRatio + 0.30 * medianScore + 0.25 * p95Score,
  );
  const status = inlierRatio >= 0.7 && calibrationQuality >= 0.65 ? 'valid' : 'invalid';

  return {
    imageToGroundH: refined,
    inlierMask: finalMask,
    inlierRatio,
    reprojectionErrorsMeters: errors,
    reprojectionErrorMedianMeters: median,
    reprojectionErrorP95Meters: p95,
    calibrationQuality,
    status,
  };
}
