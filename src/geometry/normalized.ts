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

export function validateNormalizedLine(line: NormalizedDirectedLine): void {
  assertNormalizedPoint(line.a);
  assertNormalizedPoint(line.b);
  if (Math.hypot(line.b.x - line.a.x, line.b.y - line.a.y) < 1e-9) {
    throw new Error('Normalized counting line must have non-zero length');
  }
}

/**
 * The geometry engine is unit-agnostic. This adapter exposes a normalized line
 * as a DirectedLine so crossings remain stable across capture resolution/profile
 * changes. A deadzone used with this line must therefore also be normalized.
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
