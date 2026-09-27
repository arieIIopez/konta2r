import type { Point2D } from '../core/types';
import {
  fitRobustCalibration,
  type CalibrationCorrespondence,
  type CalibrationFitOptions,
  type CalibrationFitResult,
} from './calibration';

export interface CalibrationCoverage {
  boundingBoxCoverage: number;
  quadrantCoverage: number;
  edgeSpread: number;
  score: number;
}

export interface CalibrationAssistantInput {
  imageWidth: number;
  imageHeight: number;
  correspondences: readonly CalibrationCorrespondence[];
  fitOptions: CalibrationFitOptions;
}

export type CalibrationAssistantStatus =
  | 'needs_more_points'
  | 'needs_better_distribution'
  | 'fit_failed'
  | 'calibrated';

export interface CalibrationAssistantReport {
  status: CalibrationAssistantStatus;
  pointCount: number;
  coverage: CalibrationCoverage;
  fit?: CalibrationFitResult;
  combinedQuality: number;
  instructions: string[];
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function extent(points: readonly Point2D[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  if (points.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }

  return { minX, minY, maxX, maxY };
}

/**
 * Estimates how well calibration points cover the observed image. A fit can
 * have low residuals while being unsafe outside a small cluster, so coverage
 * is treated independently from reprojection error.
 */
export function assessCorrespondenceCoverage(
  correspondences: readonly CalibrationCorrespondence[],
  imageWidth: number,
  imageHeight: number,
): CalibrationCoverage {
  if (!(imageWidth > 0) || !(imageHeight > 0) || correspondences.length === 0) {
    return { boundingBoxCoverage: 0, quadrantCoverage: 0, edgeSpread: 0, score: 0 };
  }

  const points = correspondences.map((item) => item.imagePoint);
  const box = extent(points);
  const widthFraction = clamp01((box.maxX - box.minX) / imageWidth);
  const heightFraction = clamp01((box.maxY - box.minY) / imageHeight);
  const boundingBoxCoverage = Math.sqrt(widthFraction * heightFraction);

  const occupiedQuadrants = new Set<string>();
  const centerX = imageWidth / 2;
  const centerY = imageHeight / 2;
  for (const point of points) {
    const qx = point.x < centerX ? 'L' : 'R';
    const qy = point.y < centerY ? 'T' : 'B';
    occupiedQuadrants.add(`${qx}${qy}`);
  }
  const quadrantCoverage = occupiedQuadrants.size / 4;

  const normalizedEdgeDistances = points.map((point) => {
    const x = clamp01(point.x / imageWidth);
    const y = clamp01(point.y / imageHeight);
    const nearestEdge = Math.min(x, 1 - x, y, 1 - y);
    return 1 - Math.min(1, nearestEdge / 0.5);
  });
  const edgeSpread = normalizedEdgeDistances.reduce((sum, value) => sum + value, 0)
    / normalizedEdgeDistances.length;

  const score = clamp01(
    0.5 * boundingBoxCoverage
    + 0.35 * quadrantCoverage
    + 0.15 * edgeSpread,
  );

  return { boundingBoxCoverage, quadrantCoverage, edgeSpread, score };
}

function instructionsForCoverage(coverage: CalibrationCoverage): string[] {
  const instructions: string[] = [];
  if (coverage.quadrantCoverage < 0.75) {
    instructions.push('Agrega puntos en sectores de la imagen que todavía no están representados.');
  }
  if (coverage.boundingBoxCoverage < 0.45) {
    instructions.push('Separa más los puntos: evita concentrarlos en una sola parte de la escena.');
  }
  if (coverage.edgeSpread < 0.4) {
    instructions.push('Incluye al menos algunos puntos cercanos a los bordes útiles del área observada.');
  }
  return instructions;
}

/**
 * Produces user-facing calibration guidance while preserving the numerical
 * fit as a separate piece of evidence.
 */
export function evaluateCalibrationAssistant(
  input: CalibrationAssistantInput,
): CalibrationAssistantReport {
  const pointCount = input.correspondences.length;
  const coverage = assessCorrespondenceCoverage(
    input.correspondences,
    input.imageWidth,
    input.imageHeight,
  );

  if (pointCount < 4) {
    return {
      status: 'needs_more_points',
      pointCount,
      coverage,
      combinedQuality: 0,
      instructions: [`Agrega ${4 - pointCount} punto(s) de correspondencia adicionales.`],
    };
  }

  if (coverage.score < 0.42) {
    return {
      status: 'needs_better_distribution',
      pointCount,
      coverage,
      combinedQuality: coverage.score,
      instructions: instructionsForCoverage(coverage),
    };
  }

  try {
    const fit = fitRobustCalibration(input.correspondences, input.fitOptions);
    const combinedQuality = Math.min(fit.calibrationQuality, coverage.score);
    const instructions: string[] = [];

    if (fit.status !== 'valid') {
      instructions.push('Revisa los puntos: el error geométrico aún es demasiado alto.');
    }
    if (fit.inlierRatio < 0.85) {
      instructions.push('Uno o más puntos parecen incompatibles con el resto de la calibración.');
    }
    if (fit.reprojectionErrorP95Meters > 0.8) {
      instructions.push('La precisión actual no es suficiente para habilitar velocidad métrica.');
    }

    return {
      status: fit.status === 'valid' ? 'calibrated' : 'fit_failed',
      pointCount,
      coverage,
      fit,
      combinedQuality,
      instructions,
    };
  } catch {
    return {
      status: 'fit_failed',
      pointCount,
      coverage,
      combinedQuality: 0,
      instructions: [
        'La geometría de los puntos es degenerada o inconsistente. Reemplaza algunos puntos por referencias más separadas.',
      ],
    };
  }
}
