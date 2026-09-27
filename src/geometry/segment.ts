import type { CrossingDirection, DirectedLine, Point2D } from '../core/types';

const EPSILON = 1e-9;

export type LineSide = 'LEFT' | 'RIGHT' | 'ON_LINE';

export interface SegmentIntersection {
  point: Point2D;
  trajectoryT: number;
  lineU: number;
}

export interface CrossingResult extends SegmentIntersection {
  direction: CrossingDirection;
  previousDistance: number;
  currentDistance: number;
}

export function distance(a: Point2D, b: Point2D): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Signed perpendicular distance to the infinite line defined by A→B.
 * Positive values lie to the left of A→B; negative values lie to the right.
 */
export function signedPerpendicularDistance(point: Point2D, line: DirectedLine): number {
  const dx = line.b.x - line.a.x;
  const dy = line.b.y - line.a.y;
  const length = Math.hypot(dx, dy);

  if (length <= EPSILON) {
    throw new Error(`Line ${line.id} has zero length`);
  }

  const cross = dx * (point.y - line.a.y) - dy * (point.x - line.a.x);
  return cross / length;
}

export function classifyLineSide(
  point: Point2D,
  line: DirectedLine,
  deadzone = 0,
): LineSide {
  if (deadzone < 0) {
    throw new Error('deadzone must be >= 0');
  }

  const signedDistance = signedPerpendicularDistance(point, line);
  if (Math.abs(signedDistance) <= deadzone) {
    return 'ON_LINE';
  }
  return signedDistance > 0 ? 'LEFT' : 'RIGHT';
}

/**
 * Finite segment intersection using parametric coordinates.
 * Collinear overlap is intentionally returned as null: movement along a counting
 * line is not, by itself, a transversal crossing event.
 */
export function intersectSegments(
  trajectoryStart: Point2D,
  trajectoryEnd: Point2D,
  lineStart: Point2D,
  lineEnd: Point2D,
): SegmentIntersection | null {
  const rx = trajectoryEnd.x - trajectoryStart.x;
  const ry = trajectoryEnd.y - trajectoryStart.y;
  const sx = lineEnd.x - lineStart.x;
  const sy = lineEnd.y - lineStart.y;

  const denominator = rx * sy - ry * sx;
  if (Math.abs(denominator) <= EPSILON) {
    return null;
  }

  const qpx = lineStart.x - trajectoryStart.x;
  const qpy = lineStart.y - trajectoryStart.y;
  const t = (qpx * sy - qpy * sx) / denominator;
  const u = (qpx * ry - qpy * rx) / denominator;

  if (t < -EPSILON || t > 1 + EPSILON || u < -EPSILON || u > 1 + EPSILON) {
    return null;
  }

  const clampedT = Math.min(1, Math.max(0, t));
  const clampedU = Math.min(1, Math.max(0, u));

  return {
    point: {
      x: trajectoryStart.x + clampedT * rx,
      y: trajectoryStart.y + clampedT * ry,
    },
    trajectoryT: clampedT,
    lineU: clampedU,
  };
}

/**
 * Determines whether one observed movement segment constitutes a valid crossing
 * of a finite directed counting line.
 *
 * Both samples must be outside the deadzone on opposite sides. This prevents
 * detector jitter around the line from generating counts. Higher-level track
 * logic may retain the last stable side while intermediate samples are inside
 * the deadzone.
 */
export function detectFiniteLineCrossing(
  previous: Point2D,
  current: Point2D,
  line: DirectedLine,
  deadzone = 0,
): CrossingResult | null {
  const previousDistance = signedPerpendicularDistance(previous, line);
  const currentDistance = signedPerpendicularDistance(current, line);

  if (Math.abs(previousDistance) <= deadzone || Math.abs(currentDistance) <= deadzone) {
    return null;
  }

  if (Math.sign(previousDistance) === Math.sign(currentDistance)) {
    return null;
  }

  const intersection = intersectSegments(previous, current, line.a, line.b);
  if (!intersection) {
    return null;
  }

  const direction: CrossingDirection =
    previousDistance > 0 && currentDistance < 0
      ? 'LEFT_TO_RIGHT'
      : 'RIGHT_TO_LEFT';

  return {
    ...intersection,
    direction,
    previousDistance,
    currentDistance,
  };
}
