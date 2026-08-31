import type { DirectedLine, Point2D } from '../core/types';

export interface NormalizedPoint2D {
  x: number;
  y: number;
}

export interface NormalizedDirectedLine {
  id: string;
  a: NormalizedPoint2D;
  b: NormalizedPoint2D;
  labelLeftToRight?: string;
  labelRightToLeft?: string;
}

function assertDimension(value: number, label: string): void {
  if (!Number.isFinite(value) || !(value > 0)) {
    throw new Error(`${label} must be finite and greater than zero`);
  }
}

export function assertNormalizedPoint(point: NormalizedPoint2D): void {
  if (
    !Number.isFinite(point.x)
    || !Number.isFinite(point.y)
    || point.x < 0
    || point.x > 1
    || point.y < 0
    || point.y > 1
  ) {
    throw new Error('Normalized point coordinates must be within [0, 1]');
  }
}

export function normalizeImagePoint(
  point: Point2D,
  frameWidth: number,
  frameHeight: number,
): NormalizedPoint2D {
  assertDimension(frameWidth, 'frameWidth');
  assertDimension(frameHeight, 'frameHeight');
  return {
    x: point.x / frameWidth,
    y: point.y / frameHeight,
  };
}

export function denormalizeImagePoint(
  point: NormalizedPoint2D,
  frameWidth: number,
  frameHeight: number,
): Point2D {
  assertDimension(frameWidth, 'frameWidth');
  assertDimension(frameHeight, 'frameHeight');
  assertNormalizedPoint(point);
  return {
    x: point.x * frameWidth,
    y: point.y * frameHeight,
  };
}

/**
 * Canonical image coordinates scale x and y by the same physical pixel scale:
 * frame height. This preserves Euclidean angles/distances under resolution
 * changes that keep the same aspect ratio (e.g. 1280x720 -> 640x360).
 */
export function imagePointToCanonical(
  point: Point2D,
  frameHeight: number,
): Point2D {
  assertDimension(frameHeight, 'frameHeight');
  return {
    x: point.x / frameHeight,
    y: point.y / frameHeight,
  };
}

export function normalizedPointToCanonical(
  point: NormalizedPoint2D,
  frameWidth: number,
  frameHeight: number,
): Point2D {
  assertDimension(frameWidth, 'frameWidth');
  assertDimension(frameHeight, 'frameHeight');
  assertNormalizedPoint(point);
  const aspectRatio = frameWidth / frameHeight;
  return {
    x: point.x * aspectRatio,
    y: point.y,
  };
}

export function validateNormalizedLine(line: NormalizedDirectedLine): void {
  assertNormalizedPoint(line.a);
  assertNormalizedPoint(line.b);
  if (Math.hypot(line.b.x - line.a.x, line.b.y - line.a.y) < 1e-9) {
    throw new Error('Normalized counting line must have non-zero length');
  }
}

/**
 * Exposes a normalized line directly in fraction coordinates. This is useful
 * for topology-only operations; metric-like deadzones should instead use the
 * aspect-correct canonical adapter below.
 */
export function normalizedLineAsDirectedLine(line: NormalizedDirectedLine): DirectedLine {
  validateNormalizedLine(line);
  return {
    id: line.id,
    a: { ...line.a },
    b: { ...line.b },
    ...(line.labelLeftToRight === undefined ? {} : { labelLeftToRight: line.labelLeftToRight }),
    ...(line.labelRightToLeft === undefined ? {} : { labelRightToLeft: line.labelRightToLeft }),
  };
}

export function normalizedLineToCanonical(
  line: NormalizedDirectedLine,
  frameWidth: number,
  frameHeight: number,
): DirectedLine {
  validateNormalizedLine(line);
  return {
    id: line.id,
    a: normalizedPointToCanonical(line.a, frameWidth, frameHeight),
    b: normalizedPointToCanonical(line.b, frameWidth, frameHeight),
    ...(line.labelLeftToRight === undefined ? {} : { labelLeftToRight: line.labelLeftToRight }),
    ...(line.labelRightToLeft === undefined ? {} : { labelRightToLeft: line.labelRightToLeft }),
  };
}
