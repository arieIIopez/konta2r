import { describe, expect, it } from 'vitest';
import { aggregateForPublicCommons } from '../../src/spatial/publicAggregation';
import type { SpatialTrackSample } from '../../src/spatial/types';

function sample(
  renderTrackId: string,
  timestampMs: number,
  xMeters: number,
  yMeters: number,
  speedMps = 4,
): SpatialTrackSample {
  return {
    schemaVersion: '2.0',
    sessionId: 'session_private',
    renderTrackId,
    timestampMs,
    entityType: 'cyclist',
    position: { xMeters, yMeters },
    speedMps,
    confidence: 0.9,
    calibrationQuality: 0.9,
    motionQuality: 0.9,
  };
}

describe('public spatial aggregation', () => {
  it('suppresses cells with too few unique tracks', () => {
    const aggregates = aggregateForPublicCommons([
      sample('r1', 10_000, 2, 2),
      sample('r1', 11_000, 3, 2),
      sample('r2', 12_000, 2, 3),
    ], { bucketMs: 60_000, cellSizeMeters: 5, minUniqueTracks: 3 });

    expect(aggregates).toHaveLength(0);
  });

  it('publishes an aggregate without exposing session or track identifiers', () => {
    const aggregates = aggregateForPublicCommons([
      sample('r1', 10_000, 2, 2, 3),
      sample('r2', 11_000, 3, 2, 4),
      sample('r3', 12_000, 2, 3, 5),
    ], { bucketMs: 60_000, cellSizeMeters: 5, minUniqueTracks: 3 });

    expect(aggregates).toHaveLength(1);
    const aggregate = aggregates[0];
    expect(aggregate?.uniqueEntities).toBe(3);
    expect(aggregate?.meanSpeedMps).toBeCloseTo(4);
    expect(Object.keys(aggregate ?? {})).not.toContain('renderTrackId');
    expect(Object.keys(aggregate ?? {})).not.toContain('sessionId');
    expect(Object.keys(aggregate ?? {})).not.toContain('timestampMs');
  });

  it('excludes low-quality samples before publication', () => {
    const weak = sample('r3', 12_000, 2, 3);
    weak.calibrationQuality = 0.2;

    const aggregates = aggregateForPublicCommons([
      sample('r1', 10_000, 2, 2),
      sample('r2', 11_000, 3, 2),
      weak,
    ], { bucketMs: 60_000, cellSizeMeters: 5, minUniqueTracks: 3, minQuality: 0.55 });

    expect(aggregates).toHaveLength(0);
  });
});
