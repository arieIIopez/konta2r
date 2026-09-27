import { describe, expect, it } from 'vitest';
import { generateNodeCredential } from '../../src/backend/nodeCredential';
import { createCommunityDeliveryRuntime } from '../../src/community/deliveryRuntime';
import type { ActiveNodeCredential } from '../../src/community/nodeProvisioning';
import type {
  CommunityOutboxItem,
  CommunityOutboxStore,
  OutboxStatus,
} from '../../src/community/outbox';
import { computeNodeQuality } from '../../src/community/quality';
import type { CommunitySequenceStore } from '../../src/community/sequenceStore';

class MemoryOutbox implements CommunityOutboxStore {
  readonly items = new Map<string, CommunityOutboxItem>();

  async put(item: CommunityOutboxItem): Promise<void> { this.items.set(item.id, structuredClone(item)); }
  async get(id: string): Promise<CommunityOutboxItem | undefined> {
    const item = this.items.get(id);
    return item ? structuredClone(item) : undefined;
  }
  async getDue(nowMs: number, limit: number, nodeId?: string): Promise<CommunityOutboxItem[]> {
    return [...this.items.values()]
      .filter((item) => item.status === 'pending' && item.nextAttemptAtMs <= nowMs)
      .filter((item) => nodeId === undefined || item.nodeId === nodeId)
      .sort((a, b) => a.sequence - b.sequence)
      .slice(0, limit)
      .map((item) => structuredClone(item));
  }
  async delete(id: string): Promise<void> { this.items.delete(id); }
  async count(status?: OutboxStatus): Promise<number> {
    return [...this.items.values()].filter((item) => status === undefined || item.status === status).length;
  }
}

class MemorySequences implements CommunitySequenceStore {
  readonly nextByNode = new Map<string, number>();
  readonly reservations = new Map<string, number>();

  async next(nodeId: string): Promise<number> {
    const value = this.nextByNode.get(nodeId) ?? 0;
    this.nextByNode.set(nodeId, value + 1);
    return value;
  }
  async reserve(nodeId: string, publicationKey: string): Promise<number> {
    const id = `${nodeId}|${publicationKey}`;
    const existing = this.reservations.get(id);
    if (existing !== undefined) return existing;
    const value = await this.next(nodeId);
    this.reservations.set(id, value);
    return value;
  }
  async release(nodeId: string, publicationKey: string): Promise<void> {
    this.reservations.delete(`${nodeId}|${publicationKey}`);
  }
  async peek(nodeId: string): Promise<number | undefined> { return this.nextByNode.get(nodeId); }
}

function credential(fill: number): string {
  return generateNodeCredential((bytes) => bytes.fill(fill));
}

function active(nodeId: string, segmentId: string, fill: number): ActiveNodeCredential {
  return {
    nodeId,
    segmentId,
    credential: credential(fill),
    credentialVersion: 1,
  };
}

function draft() {
  return {
    softwareVersion: '2.0.0-alpha.1',
    methodologyVersion: '2.0',
    modelFingerprint: 'sha256:model-test',
    quality: computeNodeQuality({
      detection: 0.9,
      tracking: 0.9,
      temporal: 0.9,
      device: 0.9,
      validation: 0.8,
    }),
    runtime: {
      uptimeRatio: 0.98,
      inferenceFpsP50: 5,
      inferenceLatencyP95Ms: 180,
      runtimeBackend: 'wasm' as const,
    },
    records: [{
      schemaVersion: '2.0' as const,
      aggregateType: 'flow' as const,
      bucketStartMs: 1_788_000_000_000,
      bucketEndMs: 1_788_000_300_000,
      entityType: 'cyclist' as const,
      direction: 'A_TO_B' as const,
      count: 6,
      meanQuality: 0.88,
    }],
  };
}

describe('Community delivery runtime v2', () => {
  it('allocates persistent per-node sequences and derives the public segment from active identity', async () => {
    const outbox = new MemoryOutbox();
    const sequences = new MemorySequences();
    const current = active('node_delivery01', 'segment-alameda-01', 4);
    const runtime = createCommunityDeliveryRuntime({
      endpoint: 'https://example.test/ingest',
      activeNode: async () => current,
      outbox,
      sequences,
      nowMs: () => 1_788_000_400_000,
    });

    const first = await runtime.enqueue(draft());
    const second = await runtime.enqueue(draft());

    expect(first.sequence).toBe(0);
    expect(second.sequence).toBe(1);
    expect(first.payload.observedSegment).toEqual({ segmentId: 'segment-alameda-01', source: 'konta2r' });
    expect(await sequences.peek(current.nodeId)).toBe(2);
  });

  it('reuses one node sequence for the same local publication key until it is released', async () => {
    const outbox = new MemoryOutbox();
    const sequences = new MemorySequences();
    const current = active('node_delivery04', 'segment-d', 5);
    const runtime = createCommunityDeliveryRuntime({
      endpoint: 'https://example.test/ingest',
      activeNode: async () => current,
      outbox,
      sequences,
      nowMs: () => 1_788_000_400_000,
    });
    const key = 'flow-v2:line:100:200';

    const first = await runtime.enqueue(draft(), { publicationKey: key });
    const retry = await runtime.enqueue(draft(), { publicationKey: key });

    expect(first.sequence).toBe(0);
    expect(retry.sequence).toBe(0);
    expect(first.id).toBe(retry.id);
    expect(await outbox.count()).toBe(1);
    expect(await sequences.peek(current.nodeId)).toBe(1);
    expect(sequences.reservations.size).toBe(1);

    await runtime.releasePublication(current.nodeId, key);
    expect(sequences.reservations.size).toBe(0);
  });

  it('does not enqueue or flush when the sensor identity is inactive', async () => {
    const outbox = new MemoryOutbox();
    const runtime = createCommunityDeliveryRuntime({
      endpoint: 'https://example.test/ingest',
      activeNode: async () => undefined,
      outbox,
      sequences: new MemorySequences(),
    });

    await expect(runtime.enqueue(draft())).rejects.toThrow(/active Konta2r node/i);
    expect(await runtime.flush()).toEqual({
      attempted: 0,
      delivered: 0,
      retryScheduled: 0,
      deadLettered: 0,
      skipped: 'node_inactive',
    });
    expect(await outbox.count()).toBe(0);
  });

  it('rejects enqueue if the active identity no longer matches the source bucket node', async () => {
    const outbox = new MemoryOutbox();
    const sequences = new MemorySequences();
    const current = active('node_delivery02', 'segment-b', 8);
    const runtime = createCommunityDeliveryRuntime({
      endpoint: 'https://example.test/ingest',
      activeNode: async () => current,
      outbox,
      sequences,
      nowMs: () => 1_788_000_400_000,
    });

    await expect(runtime.enqueue(draft(), {
      publicationKey: 'flow-v2:node_delivery01:line:100:200',
      expectedNodeId: 'node_delivery01',
    })).rejects.toThrow(/changed before Community enqueue/i);

    expect(await outbox.count()).toBe(0);
    expect(await sequences.peek(current.nodeId)).toBeUndefined();
    expect(sequences.reservations.size).toBe(0);
  });

  it('flushes only the currently active node after identity changes', async () => {
    const outbox = new MemoryOutbox();
    const sequences = new MemorySequences();
    let current: ActiveNodeCredential | undefined = active('node_delivery01', 'segment-a', 7);
    const deliveredNodeIds: string[] = [];
    const runtime = createCommunityDeliveryRuntime({
      endpoint: 'https://example.test/ingest',
      activeNode: async () => current,
      outbox,
      sequences,
      nowMs: () => 1_788_000_400_000,
      fetchImpl: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as { nodeId: string };
        deliveredNodeIds.push(body.nodeId);
        return new Response('', { status: 201 });
      },
    });

    const oldBatch = await runtime.enqueue(draft());
    current = active('node_delivery02', 'segment-b', 8);
    const currentBatch = await runtime.enqueue(draft());

    const result = await runtime.flush({ nowMs: 1_788_000_400_000 });

    expect(result.delivered).toBe(1);
    expect(deliveredNodeIds).toEqual(['node_delivery02']);
    expect(await outbox.get(oldBatch.id)).toBeDefined();
    expect(await outbox.get(currentBatch.id)).toBeUndefined();
  });

  it('keeps a batch pending across a temporary credential rejection instead of dead-lettering it', async () => {
    const outbox = new MemoryOutbox();
    const current = active('node_delivery03', 'segment-c', 9);
    const runtime = createCommunityDeliveryRuntime({
      endpoint: 'https://example.test/ingest',
      activeNode: async () => current,
      outbox,
      sequences: new MemorySequences(),
      nowMs: () => 1_788_000_400_000,
      fetchImpl: async () => new Response('', { status: 401 }),
    });
    const item = await runtime.enqueue(draft());

    const result = await runtime.flush({ nowMs: 1_788_000_400_000, randomUnit: () => 0.5 });

    expect(result.retryScheduled).toBe(1);
    expect(result.deadLettered).toBe(0);
    expect((await outbox.get(item.id))?.status).toBe('pending');
  });
});
