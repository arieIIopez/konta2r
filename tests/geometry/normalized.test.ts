import { describe, expect, it } from 'vitest';
import {
  canonicalPointToNormalized,
  denormalizeImagePoint,
  imagePointToCanonical,
  normalizeImagePoint,
  normalizedPointToCanonical,
} from '../../src/geometry/normalized';

describe('normalized image geometry', () => {
  it('round-trips image points through normalized coordinates', () => {
    const point = { x: 640, y: 360 };
    const normalized = normalizeImagePoint(point, 1280, 720);
    expect(normalized).toEqual({ x: 0.5, y: 0.5 });
    expect(denormalizeImagePoint(normalized, 1280, 720)).toEqual(point);
  });

  it('keeps canonical coordinates invariant under same-aspect resolution changes', () => {
    const high = imagePointToCanonical({ x: 512, y: 360 }, 720);
    const low = imagePointToCanonical({ x: 256, y: 180 }, 360);
    expect(high.x).toBeCloseTo(low.x, 10);
    expect(high.y).toBeCloseTo(low.y, 10);
  });

  it('round-trips normalized points through aspect-correct canonical coordinates', () => {
    const normalized = { x: 0.73, y: 0.42 };
    const canonical = normalizedPointToCanonical(normalized, 1920, 1080);
    const roundTrip = canonicalPointToNormalized(canonical, 1920, 1080);
    expect(roundTrip.x).toBeCloseTo(normalized.x, 10);
    expect(roundTrip.y).toBeCloseTo(normalized.y, 10);
  });
});
