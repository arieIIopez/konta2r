import type { Point2D } from '../core/types';

export interface StaticAnchorObservation {
  reference: Point2D;
  current: Point2D;
  confidence?: number;
}

export interface CameraStabilityOptions {
  minAnchors?: number;
  maxMedianDisplacementPx?: number;
  maxP95DisplacementPx?: number;
  maxScaleDriftRatio?: number;
  minAnchorConfidence?: number;
}

export interface CameraStabilityReport {
  status: 'stable' | 'uncertain' | 'moved';
  anchorCount: number;
  medianDisplacementPx: number;
  p95DisplacementPx: number;
  scaleDriftRatio: number;
  score: number;
  reasons: string[];
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) {
    return Number.POSITIVE_INFINITY;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index] ?? Number.POSITIVE_INFINITY;
}

function distance(a: Point2D, b: Point2D): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function robustScaleRatio(anchors: readonly StaticAnchorObservation[]): number {
  const ratios: number[] = [];
  for (let i = 0; i < anchors.length - 1; i += 1) {
    const a = anchors[i];
    if (!a) continue;
    for (let j = i + 1; j < anchors.length; j += 1) {
      const b = anchors[j];
      if (!b) continue;
      const referenceDistance = distance(a.reference, b.reference);
      if (referenceDistance < 20) continue;
      const currentDistance = distance(a.current, b.current);
      ratios.push(currentDistance / referenceDistance);
    }
  }

  if (ratios.length === 0) {
    return 1;
  }
  return percentile(ratios, 0.5);
}

/**
 * Assesses whether the camera geometry has drifted using only local static
 * anchor coordinates. No image, descriptor or persistent identity is required
 * by this contract; feature extraction remains an Edge-only concern.
 */
export function assessCameraStability(
  observations: readonly StaticAnchorObservation[],
  options: CameraStabilityOptions = {},
): CameraStabilityReport {
  const minAnchors = Math.max(4, options.minAnchors ?? 10);
  const maxMedian = options.maxMedianDisplacementPx ?? 3;
  const maxP95 = options.maxP95DisplacementPx ?? 8;
  const maxScaleDrift = options.maxScaleDriftRatio ?? 0.015;
  const minConfidence = clamp01(options.minAnchorConfidence ?? 0.5);

  const anchors = observations.filter((observation) => (
    observation.confidence === undefined || observation.confidence >= minConfidence
  ));

  if (anchors.length < minAnchors) {
    return {
      status: 'uncertain',
      anchorCount: anchors.length,
      medianDisplacementPx: Number.POSITIVE_INFINITY,
      p95DisplacementPx: Number.POSITIVE_INFINITY,
      scaleDriftRatio: Number.POSITIVE_INFINITY,
      score: 0,
      reasons: ['insufficient_static_anchors'],
    };
  }

  const displacements = anchors.map((anchor) => distance(anchor.reference, anchor.current));
  const medianDisplacementPx = percentile(displacements, 0.5);
  const p95DisplacementPx = percentile(displacements, 0.95);
  const scaleRatio = robustScaleRatio(anchors);
  const scaleDriftRatio = Math.abs(scaleRatio - 1);

  const reasons: string[] = [];
  if (medianDisplacementPx > maxMedian) {
    reasons.push('median_anchor_displacement_exceeded');
  }
  if (p95DisplacementPx > maxP95) {
    reasons.push('p95_anchor_displacement_exceeded');
  }
  if (scaleDriftRatio > maxScaleDrift) {
    reasons.push('camera_scale_or_zoom_changed');
  }

  const displacementScore = Math.exp(-medianDisplacementPx / Math.max(maxMedian, 0.1));
  const tailScore = Math.exp(-p95DisplacementPx / Math.max(maxP95, 0.1));
  const scaleScore = Math.exp(-scaleDriftRatio / Math.max(maxScaleDrift, 0.001));
  const score = clamp01(0.45 * displacementScore + 0.3 * tailScore + 0.25 * scaleScore);

  return {
    status: reasons.length === 0 ? 'stable' : 'moved',
    anchorCount: anchors.length,
    medianDisplacementPx,
    p95DisplacementPx,
    scaleDriftRatio,
    score,
    reasons,
  };
}
