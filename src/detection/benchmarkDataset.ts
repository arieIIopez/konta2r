import type { BoundingBox } from '../core/types';

export type GroundTruthOcclusion = 'none' | 'partial' | 'heavy';
export type ImageScaleBin = 'tiny' | 'small' | 'medium' | 'large';

export interface GroundTruthObject {
  annotationId: string;
  className: string;
  bbox: BoundingBox;
  occlusion?: GroundTruthOcclusion;
  /** Ignored objects do not contribute FN and can absorb an overlapping detection. */
  ignore?: boolean;
}

export interface AnnotatedBenchmarkFrame {
  frameId: string;
  /** Logical timestamp carried into DetectorInput and benchmark records. */
  timestampMs: number;
  /** Optional seek position in the source medium; deliberately distinct from timestampMs. */
  mediaTimeMs?: number;
  width: number;
  height: number;
  objects: GroundTruthObject[];
}

export interface AnnotatedBenchmarkSequence {
  schemaVersion: '1';
  datasetId: string;
  sequenceId: string;
  frames: AnnotatedBenchmarkFrame[];
  source?: {
    mediaSha256?: string;
    annotationSha256?: string;
    note?: string;
  };
}

export interface ImageScaleThresholds {
  tinyMaxHeightRatio: number;
  smallMaxHeightRatio: number;
  mediumMaxHeightRatio: number;
}

/**
 * Operational image-scale strata for mobility scenes. They describe how many
 * image pixels an object occupies, not its physical size in the street.
 */
export const DEFAULT_IMAGE_SCALE_THRESHOLDS: ImageScaleThresholds = {
  tinyMaxHeightRatio: 0.04,
  smallMaxHeightRatio: 0.10,
  mediumMaxHeightRatio: 0.25,
};

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

export function validateGroundTruthObject(
  object: GroundTruthObject,
  frameWidth: number,
  frameHeight: number,
): void {
  if (object.annotationId.trim().length === 0) throw new Error('annotationId is required');
  if (object.className.trim().length === 0) throw new Error('className is required');
  const { x, y, width, height } = object.bbox;
  if (![x, y, width, height].every(Number.isFinite) || !finitePositive(width) || !finitePositive(height)) {
    throw new Error(`Invalid ground-truth bbox for ${object.annotationId}`);
  }
  if (x + width <= 0 || y + height <= 0 || x >= frameWidth || y >= frameHeight) {
    throw new Error(`Ground-truth bbox for ${object.annotationId} does not intersect the frame`);
  }
}

export function validateAnnotatedBenchmarkFrame(frame: AnnotatedBenchmarkFrame): void {
  if (frame.frameId.trim().length === 0) throw new Error('frameId is required');
  if (!finitePositive(frame.width) || !finitePositive(frame.height)) {
    throw new Error(`Frame ${frame.frameId} dimensions must be greater than zero`);
  }
  if (!Number.isFinite(frame.timestampMs)) throw new Error(`Frame ${frame.frameId} timestamp must be finite`);
  if (frame.mediaTimeMs !== undefined && (!Number.isFinite(frame.mediaTimeMs) || frame.mediaTimeMs < 0)) {
    throw new Error(`Frame ${frame.frameId} mediaTimeMs must be finite and non-negative`);
  }

  const ids = new Set<string>();
  for (const object of frame.objects) {
    if (ids.has(object.annotationId)) {
      throw new Error(`Duplicate annotationId ${object.annotationId} in frame ${frame.frameId}`);
    }
    ids.add(object.annotationId);
    validateGroundTruthObject(object, frame.width, frame.height);
  }
}

export function validateAnnotatedBenchmarkSequence(sequence: AnnotatedBenchmarkSequence): void {
  if (sequence.schemaVersion !== '1') throw new Error('Unsupported benchmark sequence schemaVersion');
  if (sequence.datasetId.trim().length === 0) throw new Error('datasetId is required');
  if (sequence.sequenceId.trim().length === 0) throw new Error('sequenceId is required');
  const frameIds = new Set<string>();
  let previousTimestamp = Number.NEGATIVE_INFINITY;
  let previousMediaTime = Number.NEGATIVE_INFINITY;
  for (const frame of sequence.frames) {
    if (frameIds.has(frame.frameId)) throw new Error(`Duplicate frameId ${frame.frameId}`);
    frameIds.add(frame.frameId);
    validateAnnotatedBenchmarkFrame(frame);
    if (frame.timestampMs < previousTimestamp) {
      throw new Error('Benchmark frame timestamps must be non-decreasing');
    }
    previousTimestamp = frame.timestampMs;

    if (frame.mediaTimeMs !== undefined) {
      if (frame.mediaTimeMs < previousMediaTime) {
        throw new Error('Benchmark frame mediaTimeMs values must be non-decreasing when provided');
      }
      previousMediaTime = frame.mediaTimeMs;
    }
  }
}

export function classifyImageScale(
  bbox: BoundingBox,
  frameHeight: number,
  thresholds: ImageScaleThresholds = DEFAULT_IMAGE_SCALE_THRESHOLDS,
): ImageScaleBin {
  if (!finitePositive(frameHeight)) throw new Error('frameHeight must be greater than zero');
  if (!finitePositive(bbox.height)) throw new Error('bbox height must be greater than zero');
  if (
    !(thresholds.tinyMaxHeightRatio > 0)
    || !(thresholds.smallMaxHeightRatio > thresholds.tinyMaxHeightRatio)
    || !(thresholds.mediumMaxHeightRatio > thresholds.smallMaxHeightRatio)
  ) {
    throw new Error('Image-scale thresholds must be positive and strictly increasing');
  }

  const ratio = bbox.height / frameHeight;
  if (ratio < thresholds.tinyMaxHeightRatio) return 'tiny';
  if (ratio < thresholds.smallMaxHeightRatio) return 'small';
  if (ratio < thresholds.mediumMaxHeightRatio) return 'medium';
  return 'large';
}
