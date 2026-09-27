import { describe, expect, it } from 'vitest';
import type { LineCrossingEvent } from '../../src/core/types';
import { aggregateCrossingsForCommunity } from '../../src/community/flowAggregation';

function crossing(
  trackId: string,
  timestampMs: number,
  direction: LineCrossingEvent['direction'] = 'LEFT_TO_RIGHT',
  confidence = 0.9,
): LineCrossingEvent {
  return {
    eventId: `event_${trackId}_${timestampMs}`,
    sessionId: 'private_session',
    trackId,
    entityType: 'cyclist',
    eventType: 'line_crossing',
    timestampMs,
    geometryId: 'line_main',
    direction,
    crossingPoint: { x: 10, y: 20 },
    confidence,
  };
}

describe('community flow aggregation', () => {
  it('removes private identifiers, local geometry and exact timestamps from outgoing records', () => {
    const base = 1_788_000_000_000;
    const aggregate = aggregateCrossingsForCommunity([
      crossing('t1', base + 10_000),
      crossing('t2', base + 20_000),
      crossing('t3', base + 30_000),
    ])[0];

    expect(aggregate?.count).toBe(3);
    expect(aggregate?.direction).toBe('A_TO_B');
    expect(Object.keys(aggregate ?? {})).not.toContain('trackId');
    expect(Object.keys(aggregate ?? {})).not.toContain('eventId');
    expect(Object.keys(aggregate ?? {})).not.toContain('sessionId');
    expect(Object.keys(aggregate ?? {})).not.toContain('timestampMs');
    expect(Object.keys(aggregate ?? {})).not.toContain('geometryId');
  });

  it('suppresses low-count buckets by default', () => {
    const base = 1_788_000_000_000;
    const aggregates = aggregateCrossingsForCommunity([
      crossing('t1', base + 10_000),
      crossing('t2', base + 20_000),
    ]);

    expect(aggregates).toHaveLength(0);
  });

  it('keeps opposite directions in separate aggregates', () => {
    const base = 1_788_000_000_000;
    const aggregates = aggregateCrossingsForCommunity([
      crossing('a1', base + 10_000, 'LEFT_TO_RIGHT'),
      crossing('a2', base + 20_000, 'LEFT_TO_RIGHT'),
      crossing('a3', base + 30_000, 'LEFT_TO_RIGHT'),
      crossing('b1', base + 40_000, 'RIGHT_TO_LEFT'),
      crossing('b2', base + 50_000, 'RIGHT_TO_LEFT'),
      crossing('b3', base + 60_000, 'RIGHT_TO_LEFT'),
    ]);

    expect(aggregates).toHaveLength(2);
    expect(aggregates.map((item) => item.direction).sort()).toEqual(['A_TO_B', 'B_TO_A']);
  });

  it('drops low-confidence local events before public aggregation', () => {
    const base = 1_788_000_000_000;
    const aggregates = aggregateCrossingsForCommunity([
      crossing('t1', base + 10_000, 'LEFT_TO_RIGHT', 0.9),
      crossing('t2', base + 20_000, 'LEFT_TO_RIGHT', 0.9),
      crossing('t3', base + 30_000, 'LEFT_TO_RIGHT', 0.3),
    ]);

    expect(aggregates).toHaveLength(0);
  });

  it('rejects event-like buckets shorter than one minute', () => {
    expect(() => aggregateCrossingsForCommunity([], { bucketMs: 30_000 })).toThrow(/60 seconds/);
  });
});
