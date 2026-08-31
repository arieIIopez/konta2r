import { describe, expect, it } from 'vitest';
import { computeNodeQuality } from '../../src/community/quality';
import {
  computeRetryDelayMs,
  enqueueCommunityUpload,
  flushCommunityOutbox,
  type CommunityOutboxItem,
  type CommunityOutboxStore,
  type OutboxStatus,
} from '../../src/community/outbox';
import type { CommunityUploadEnvelope } from '../../src/community/protocol';

class MemoryOutbox implements CommunityOutboxStore {
  readonly items = new Map<string, CommunityOutboxItem>();

  async put(item: CommunityOutboxItem): Promise<void> {
    this.items.set(item.id, structuredClone(item));
  }

  async get(id: string): Promise<CommunityOutboxItem | undefined> {
    const item = this.items.get(id);
    return item ? structuredClone(item) : undefined;
  }

  async getDue(nowMs: number, limit: number): Promise<CommunityOutboxItem[]> {
    return [...this.items.values()]
      .filter((item) => item.status === 'pending' && item.nextAttemptAtMs <= nowMs)
      .sort((a, b) => a.nextAttemptAtMs - b.nextAttemptAtMs)
      .slice(0, limit)
      .map((item) => structuredClone(item));
  }

  async delete(id: string): Promise<void> {
    this.items.delete(id);
  }

  async count(status?: OutboxStatus): Promise<number> {
    if (status === undefined) return this.items.size;
    return [...this.items.values()].filter((item) => item.status === status).length;
  }
}

function envelope(sequence = 1): CommunityUploadEnvelope {
  return {
    schemaVersion: '2.0',
    nodeId: 'node_test1234',
    sequence,
    generatedAtIso: '2026-08-30T23:00:00.000Z',
    observedSegment: { segmentId: 'segment_test', source: 'konta2r' },
    softwareVersion: '2.0.0-alpha.1',
    methodologyVersion: '2.0',
    modelFingerprint: 'sha256:test',
    quality: computeNodeQuality({
      detection: 0.9,
      tracking: 0.9,
      temporal: 0.95,
      device: 0.9,
      validation: 0.85,
    }),
    runtime: {
      uptimeRatio: 0.99,
      inferenceFpsP50: 4.8,
      inferenceLatencyP95Ms: 190,
      runtimeBackend: 'wasm',
    },
    records: [{
      schemaVersion: '2.0',
      aggregateType: 'flow',
      bucketStartMs: 1_788_000_000_000,
      bucketEndMs: 1_788_000_300_000,
      entityType: 'pedestrian',
      direction: 'A_TO_B',
      count: 20,
      meanQuality: 0.88,
    }],
  };
}

describe('community offline outbox', () => {
  it('deduplicates the same node sequence before network delivery', async () => {
    const store = new MemoryOutbox();
    await enqueueCommunityUpload(store, envelope(7), 1000);
    await enqueueCommunityUpload(store, envelope(7), 2000);

    expect(await store.count()).toBe(1);
    expect((await store.get('node_test1234:7'))?.createdAtMs).toBe(1000);
  });

  it('deletes an aggregate only after a successful acknowledged delivery', async () => {
    const store = new MemoryOutbox();
    await enqueueCommunityUpload(store, envelope(1), 1000);

    const result = await flushCommunityOutbox(
      store,
      async (_payload, idempotencyKey) => {
        expect(idempotencyKey).toBe('node_test1234:1');
        return { ok: true, retryable: false, statusCode: 202 };
      },
      { nowMs: 1000 },
    );

    expect(result.delivered).toBe(1);
    expect(await store.count()).toBe(0);
  });

  it('schedules retry after a temporary network/server failure', async () => {
    const store = new MemoryOutbox();
    await enqueueCommunityUpload(store, envelope(2), 1000);

    const result = await flushCommunityOutbox(
      store,
      async () => ({ ok: false, retryable: true, statusCode: 503, error: 'unavailable' }),
      { nowMs: 1000, randomUnit: () => 0.5 },
    );

    const pending = await store.get('node_test1234:2');
    expect(result.retryScheduled).toBe(1);
    expect(pending?.attempts).toBe(1);
    expect(pending?.nextAttemptAtMs).toBe(1000 + computeRetryDelayMs(1, 0.5));
  });

  it('dead-letters a permanent validation/auth failure instead of retrying forever', async () => {
    const store = new MemoryOutbox();
    await enqueueCommunityUpload(store, envelope(3), 1000);

    const result = await flushCommunityOutbox(
      store,
      async () => ({ ok: false, retryable: false, statusCode: 400, error: 'invalid payload' }),
      { nowMs: 1000 },
    );

    expect(result.deadLettered).toBe(1);
    expect((await store.get('node_test1234:3'))?.status).toBe('dead_letter');
  });

  it('caps exponential retry delay to avoid unbounded waits', () => {
    expect(computeRetryDelayMs(1, 0.5)).toBe(2000);
    expect(computeRetryDelayMs(20, 0.5)).toBeLessThanOrEqual(15 * 60_000);
  });
});
