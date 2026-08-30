import { describe, expect, it } from 'vitest';
import type { DirectedLine } from '../../src/core/types';
import {
  classifyLineSide,
  detectFiniteLineCrossing,
  intersectSegments,
  signedPerpendicularDistance,
} from '../../src/geometry/segment';

const verticalLine: DirectedLine = {
  id: 'screenline-1',
  a: { x: 0, y: 0 },
  b: { x: 0, y: 10 },
};

describe('signedPerpendicularDistance', () => {
  it('returns a true perpendicular distance independent of line length', () => {
    expect(signedPerpendicularDistance({ x: -3, y: 5 }, verticalLine)).toBeCloseTo(3);
    expect(signedPerpendicularDistance({ x: 4, y: 5 }, verticalLine)).toBeCloseTo(-4);

    const longLine: DirectedLine = {
      id: 'long',
      a: { x: 0, y: 0 },
      b: { x: 0, y: 1000 },
    };
    expect(signedPerpendicularDistance({ x: -3, y: 500 }, longLine)).toBeCloseTo(3);
  });

  it('classifies a metric deadzone consistently', () => {
    expect(classifyLineSide({ x: -2, y: 5 }, verticalLine, 3)).toBe('ON_LINE');
    expect(classifyLineSide({ x: -4, y: 5 }, verticalLine, 3)).toBe('LEFT');
    expect(classifyLineSide({ x: 4, y: 5 }, verticalLine, 3)).toBe('RIGHT');
  });
});

describe('intersectSegments', () => {
  it('finds the finite intersection and interpolation position', () => {
    const hit = intersectSegments(
      { x: -5, y: 5 },
      { x: 5, y: 5 },
      verticalLine.a,
      verticalLine.b,
    );

    expect(hit).not.toBeNull();
    expect(hit?.point.x).toBeCloseTo(0);
    expect(hit?.point.y).toBeCloseTo(5);
    expect(hit?.trajectoryT).toBeCloseTo(0.5);
    expect(hit?.lineU).toBeCloseTo(0.5);
  });

  it('does not treat crossing the infinite extension as crossing the segment', () => {
    const hit = intersectSegments(
      { x: -5, y: 20 },
      { x: 5, y: 20 },
      verticalLine.a,
      verticalLine.b,
    );

    expect(hit).toBeNull();
  });
});

describe('detectFiniteLineCrossing', () => {
  it('registers a left-to-right transversal crossing', () => {
    const crossing = detectFiniteLineCrossing(
      { x: -5, y: 5 },
      { x: 5, y: 5 },
      verticalLine,
      1,
    );

    expect(crossing).not.toBeNull();
    expect(crossing?.direction).toBe('LEFT_TO_RIGHT');
    expect(crossing?.point).toEqual({ x: 0, y: 5 });
  });

  it('registers the inverse direction', () => {
    const crossing = detectFiniteLineCrossing(
      { x: 5, y: 5 },
      { x: -5, y: 5 },
      verticalLine,
      1,
    );

    expect(crossing?.direction).toBe('RIGHT_TO_LEFT');
  });

  it('rejects movement outside the finite segment', () => {
    expect(
      detectFiniteLineCrossing(
        { x: -5, y: 20 },
        { x: 5, y: 20 },
        verticalLine,
        1,
      ),
    ).toBeNull();
  });

  it('rejects jitter inside the deadzone', () => {
    expect(
      detectFiniteLineCrossing(
        { x: -0.5, y: 5 },
        { x: 0.5, y: 5 },
        verticalLine,
        1,
      ),
    ).toBeNull();
  });

  it('rejects movement that stays on the same side', () => {
    expect(
      detectFiniteLineCrossing(
        { x: -5, y: 2 },
        { x: -2, y: 8 },
        verticalLine,
        1,
      ),
    ).toBeNull();
  });
});
