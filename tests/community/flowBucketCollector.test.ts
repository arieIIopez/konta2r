import { describe, expect, it } from 'vitest';
import type { LineCrossingEvent } from '../../src/core/types';
import {
  CommunityFlowBucketCollector,
} from '../../src/community/flowBucketCollector';
import type {
  CommunityFlowBucketCell,
  CommunityFlowBucketDelta,
  CommunityFlowBucketStore,
} from '../../src/community/flowBucketStore';

const NODE_A = 'node_bucket01';
const NODE_B = 'node_bucket02';

class MemoryBucketStore implements CommunityFlowBucketStore {
  readonly cells = new Map<string, CommunityFlowBucketCell>();

  async add(delta: CommunityFlowBucketDelta): Promise<void> {
    const id = [
      delta.nodeId,
      delta.streamId,
      delta.bucketStartMs,
      delta.entityType,
      delta.direction,
    ].join('|');
    const existing = this.cells.get(id);
    this.cells.set(id, {
      id,
      ...delta,
      count: (existing?.count ?? 0) + delta.count,
      qualitySum: (existing?.qualitySum ?? 0) + delta.qualitySum,
    });
  }

  async listClosedBucketStarts(nodeId: string, streamId: string, nowMs: number): Promise<number[]> {
    return [...new Set([...this.cells.values()]
      .filter((cell) => (
        cell.nodeId === nodeId
        && cell.streamId === streamId
        && cell.bucketEndMs <= nowMs
      ))
      .map((cell) => cell.bucketStartMs))]
      .sort((a, b) => a - b);
  }

  async listBucket(
    nodeId: string,
    streamId: string,
    bucketStartMs: number,
  ): Promise<CommunityFlowBucketCell[]> {
    return [...this.cells.values()].filter(
      (cell) => (
        cell.nodeId === nodeId
        && cell.streamId === streamId
        && cell.bucketStartMs === bucketStartMs
      ),
    );
  }

  async deleteBucket(nodeId: string, streamId: string, bucketStartMs: number): Promise<void> {
    for (const [id, cell] of this.cells) {
      if (
        cell.nodeId === nodeId
        && cell.streamId === streamId
        && cell.bucketStartMs === bucketStartMs
      ) this.cells.delete(id);
    }
  }
}

function crossing(
  id: string,
  confidence = 0.9,
  geometryId = 'line_main',
): LineCrossingEvent {
  return {
    eventId: `event_${id}`,
    sessionId: 'private-session',
    trackId: `track_${id}`,
    entityType: 'cyclist',
    eventType: 'line_crossing',
    timestampMs: 1_788_000_000_000 + Number(id),
    geometryId,
    direction: 'LEFT_TO_RIGHT',
    crossingPoint: { x: 0.4, y: 0.5 },
    crossingPointSpace: 'normalized_image',
    confidence,
  };
}

describe('CommunityFlowBucketCollector', () => {
  it('persists only identity-scoped counters and quality sums, not event-level identifiers', async () => {
    const store = new MemoryBucketStore();
    const collector = new CommunityFlowBucketCollector(store, {
      countingGeometryId: 'line_main',
      bucketMs: 300_000,
      minCount: 3,
    });

    await collector.observe(NODE_A, [crossing('1'), crossing('2'), crossing('3')], 1_788_000_040_000);

    expect(store.cells.size).toBe(1);
    const cell = [...store.cells.values()][0];
    expect(cell?.nodeId).toBe(NODE_A);
    expect(cell?.count).toBe(3);
    expect(cell?.qualitySum).toBeCloseTo(2.7);
    const keys = Object.keys(cell ?? {});
    expect(keys).not.toContain('trackId');
    expect(keys).not.toContain('eventId');
    expect(keys).not.toContain('sessionId');
    expect(keys).not.toContain('timestampMs');
    expect(keys).not.toContain('crossingPoint');
  });

  it('filters other geometries and low-confidence crossings before persistence', async () => {
    const store = new MemoryBucketStore();
    const collector = new CommunityFlowBucketCollector(store, {
      countingGeometryId: 'line_main',
      minEventConfidence: 0.5,
    });

    await collector.observe(NODE_A, [
      crossing('1', 0.9),
      crossing('2', 0.4),
      crossing('3', 0.9, 'other_line'),
    ], 1_788_000_040_000);

    expect([...store.cells.values()][0]?.count).toBe(1);
  });

  it('suppresses low-count public cells while retaining the closed bucket for explicit commit', async () => {
    const store = new MemoryBucketStore();
    const collector = new CommunityFlowBucketCollector(store, {
      countingGeometryId: 'line_main',
      bucketMs: 60_000,
      minCount: 3,
    });
    const observedAt = 1_788_000_010_000;
    await collector.observe(NODE_A, [crossing('1'), crossing('2')], observedAt);

    const closed = await collector.closed(NODE_A, observedAt + 70_000);
    expect(closed).toHaveLength(1);
    expect(closed[0]?.nodeId).toBe(NODE_A);
    expect(closed[0]?.records).toHaveLength(0);
    expect(closed[0]?.suppressedCount).toBe(2);
    expect(store.cells.size).toBe(1);

    await collector.commit(NODE_A, closed[0]?.bucketStartMs ?? 0);
    expect(store.cells.size).toBe(0);
  });

  it('never exposes a previous node bucket through a newly provisioned node identity', async () => {
    const store = new MemoryBucketStore();
    const collector = new CommunityFlowBucketCollector(store, {
      countingGeometryId: 'line_main',
      bucketMs: 60_000,
      minCount: 1,
    });
    const observedAt = 1_788_000_010_000;
    await collector.observe(NODE_A, [crossing('1')], observedAt);

    expect(await collector.closed(NODE_B, observedAt + 70_000)).toEqual([]);
    const original = await collector.closed(NODE_A, observedAt + 70_000);
    expect(original).toHaveLength(1);
    expect(original[0]?.nodeId).toBe(NODE_A);
  });
});
