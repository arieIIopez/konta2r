import type { BoundingBox, RawDetection } from '../core/types';
import { solveMinimumCostAssignment } from '../tracking/hungarian';
import type { DetectorAccuracyObservation } from './types';
import {
  classifyImageScale,
  type GroundTruthObject,
  type GroundTruthOcclusion,
  type ImageScaleBin,
  type ImageScaleThresholds,
} from './benchmarkDataset';

export interface DetectionGroundTruthMatch {
  annotationId: string;
  detectionIndex: number;
  className: string;
  iou: number;
  confidence: number;
  scaleBin: ImageScaleBin;
  occlusion: GroundTruthOcclusion;
}

export interface FrameDetectionEvaluation {
  matches: DetectionGroundTruthMatch[];
  falsePositiveDetectionIndices: number[];
  falseNegativeAnnotationIds: string[];
  ignoredDetectionIndices: number[];
  accuracyObservations: DetectorAccuracyObservation[];
}

export interface GroundTruthMatchingOptions {
  iouThreshold?: number;
  scaleThresholds?: ImageScaleThresholds;
}

function area(box: BoundingBox): number {
  return Math.max(0, box.width) * Math.max(0, box.height);
}

export function boundingBoxIoU(a: BoundingBox, b: BoundingBox): number {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  const union = area(a) + area(b) - intersection;
  return union <= 0 ? 0 : intersection / union;
}

function normalizeThreshold(value: number | undefined): number {
  const threshold = value ?? 0.5;
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1) {
    throw new Error('IoU threshold must be within (0, 1]');
  }
  return threshold;
}

function buildAccuracyObservations(
  detections: readonly RawDetection[],
  groundTruth: readonly GroundTruthObject[],
  matches: readonly DetectionGroundTruthMatch[],
  falsePositiveDetectionIndices: readonly number[],
  falseNegativeAnnotationIds: readonly string[],
): DetectorAccuracyObservation[] {
  const classes = new Set<string>();
  for (const annotation of groundTruth) {
    if (!annotation.ignore) classes.add(annotation.className);
  }
  for (const detectionIndex of falsePositiveDetectionIndices) {
    const detection = detections[detectionIndex];
    if (detection) classes.add(detection.className);
  }

  return [...classes]
    .sort((a, b) => a.localeCompare(b))
    .map((className) => ({
      className,
      truePositive: matches.filter((match) => match.className === className).length,
      falsePositive: falsePositiveDetectionIndices.filter((index) => detections[index]?.className === className).length,
      falseNegative: falseNegativeAnnotationIds.filter((annotationId) => (
        groundTruth.find((annotation) => annotation.annotationId === annotationId)?.className === className
      )).length,
    }));
}

/**
 * Class-aware one-to-one matching. Hungarian assignment maximizes total IoU
 * (by minimizing 1-IoU), so evaluation does not depend on detector output order.
 * Ignored annotations are excluded from FN and can absorb otherwise-unmatched
 * detections of the same class, preventing them from becoming false positives.
 */
export function evaluateDetectionsAgainstGroundTruth(
  detections: readonly RawDetection[],
  groundTruth: readonly GroundTruthObject[],
  frameHeight: number,
  options: GroundTruthMatchingOptions = {},
): FrameDetectionEvaluation {
  const iouThreshold = normalizeThreshold(options.iouThreshold);
  const evaluable = groundTruth.filter((annotation) => !annotation.ignore);
  const ignored = groundTruth.filter((annotation) => annotation.ignore === true);
  const costMatrix = evaluable.map((annotation) => detections.map((detection) => {
    if (annotation.className !== detection.className) return Number.POSITIVE_INFINITY;
    return 1 - boundingBoxIoU(annotation.bbox, detection.bbox);
  }));
  const assignments = solveMinimumCostAssignment(costMatrix, 1 - iouThreshold);
  const matchedDetectionIndices = new Set<number>();
  const matchedAnnotationIds = new Set<string>();
  const matches: DetectionGroundTruthMatch[] = [];

  for (const assignment of assignments) {
    const annotation = evaluable[assignment.row];
    const detection = detections[assignment.column];
    if (!annotation || !detection) continue;
    const iou = boundingBoxIoU(annotation.bbox, detection.bbox);
    if (iou < iouThreshold) continue;
    matchedDetectionIndices.add(assignment.column);
    matchedAnnotationIds.add(annotation.annotationId);
    matches.push({
      annotationId: annotation.annotationId,
      detectionIndex: assignment.column,
      className: annotation.className,
      iou,
      confidence: detection.confidence,
      scaleBin: classifyImageScale(annotation.bbox, frameHeight, options.scaleThresholds),
      occlusion: annotation.occlusion ?? 'none',
    });
  }

  const ignoredDetectionIndices: number[] = [];
  const falsePositiveDetectionIndices: number[] = [];
  for (let index = 0; index < detections.length; index += 1) {
    if (matchedDetectionIndices.has(index)) continue;
    const detection = detections[index];
    if (!detection) continue;
    const absorbed = ignored.some((annotation) => (
      annotation.className === detection.className
      && boundingBoxIoU(annotation.bbox, detection.bbox) >= iouThreshold
    ));
    if (absorbed) ignoredDetectionIndices.push(index);
    else falsePositiveDetectionIndices.push(index);
  }

  const falseNegativeAnnotationIds = evaluable
    .filter((annotation) => !matchedAnnotationIds.has(annotation.annotationId))
    .map((annotation) => annotation.annotationId);

  return {
    matches: matches.sort((a, b) => a.annotationId.localeCompare(b.annotationId)),
    falsePositiveDetectionIndices,
    falseNegativeAnnotationIds,
    ignoredDetectionIndices,
    accuracyObservations: buildAccuracyObservations(
      detections,
      groundTruth,
      matches,
      falsePositiveDetectionIndices,
      falseNegativeAnnotationIds,
    ),
  };
}
