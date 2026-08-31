import { describe, expect, it } from 'vitest';
import { generateNodeCredential } from '../../src/backend/nodeCredential';
import type { NodeCredentialSecret, NodeCredentialVault } from '../../src/backend/nodeCredentialVault';
import { createCommunityDeliveryRuntime } from '../../src/community/deliveryRuntime';
import type {
  CommunityOutboxItem,
  CommunityOutboxStore,
  OutboxStatus,
} from '../../src/community/outbox';
import type { CommunityUploadEnvelope } from '../../src/community/protocol';
import { computeNodeQuality } from '../../src/community/quality';

const NODE_ID = 'node_delivery01';

function envelope(nodeId = NODE_ID, sequence = 1): CommunityUploadEnvelope {
  return {
    schemaVersion: '2.0',
    nodeId,
    sequence,
    generatedAtIso: '2026-08-31T20:00:00.000Z',
    observedSegment: { segmentId: 'seg-1', source: 'konta2r' },
    softwareVersion: '2.0.0-alpha.1',
    methodologyVersion: '2.0',
    modelFingerprint: 'sha256:test',
    quality: computeNodeQuality({
      detection: 0.9,
      tracking: 0.9,
      temporal: 0.9,
      device: 0.9,
      validation: 0.85,
    }),
    runtime: {
      uptimeRatio: 0.95,
      inferenceFpsP50: 5,
      inferenceLatencyP95Ms: 190,
      runtimeBackend: 'wasm',
    },
    records: [{
      schemaVersion: '2.0',
      aggregateType: 'flow',
      bucketStartMs: 1_788_000_000_000,
      bucketEndMs: 1_788_000_300_000,
      entityType: 'cyclist',
      direction: 'A_TO_B',
      count: 6,
      meanQuality: 0.88,
    }],
  };
}

class MemoryVault implements NodeCredentialVault {
  value: NodeCredentialSecret | undefined;

  async put(value: NodeCredentialSecret): Promise<void> { this.value = { ...value }; }
  async get(nodeId: string): Promise<NodeCredentialSecret | undefined> {
    return this.value?.nodeId === nodeId ? { ...this.value } : undefined;
  }
  async delete(nodeId: string): Promise<void> {
    if (this.value?.nodeId === nodeId) this.value = undefined;
  }
  async has(nodeId: string): Promise<boolean> { return this.value?.nodeId === nodeId; }
}

class MemoryOutbox implements CommunityOutboxStore {
  values = new Map<string, CommunityOutboxItem>();

  async put(item: CommunityOutboxItem): Promise<void> { this.values.set(item.id, { ...item }); }
  async get(id: string): Promise<CommunityOutboxItem | undefined> {
    const value = this.values.get(id);
    return value ? { ...value } : undefined;
  }
  async getDue(nowMs: number, limit: number): Promise<CommunityOutboxItem[]> {
    return [...this.values.values()]
      .filter((value) => value.status === 'pending' && value.nextAttemptAtMs <= nowMs)
      .sort((a, b) => a.sequence - b.sequence)
      .slice(0, limit)
      .map((value) => ({ ...value }));
  }
  async delete(id: string): Promise<void> { this.values.delete(id); }
  async count(status?: OutboxStatus): Promise<number> {
    return [...this.values.values()].filter((value) => status === undefined || value.status === status).length;
  }
}

function credential(fill: number): string {
  return generateNodeCredential((bytes) => bytes.fill(fill));
}

describe('Community delivery runtime', () => {
  it('rejects envelopes belonging to a different node before they enter the outbox', async () => {
    const outbox = new MemoryOutbox();
    const runtime = createCommunityDeliveryRuntime({
      nodeId: NODE_ID,
      endpoint: 'https://example.test/ingest',
      vault: new MemoryVault(),
      outbox,
    });

    await expect(runtime.enqueue(envelope('node_someoneelse', 1), 100)).rejects.toThrow('identity');
    expect(await outbox.count()).toBe(0);
  });

  it('resolves the current vault credential only when flushing and deletes delivered items', async () => {
    const vault = new MemoryVault();
    const outbox = new MemoryOutbox();
    const firstCredential = credential(4);
    await vault.put({ nodeId: NODE_ID, credential: firstCredential, keyVersion: 1 });
    let authorization = '';
    const runtime = createCommunityDeliveryRuntime({
      nodeId: NODE_ID,
      endpoint: 'https://example.test/ingest',
      vault,
      outbox,
      fetchImpl: async (_input, init) => {
        authorization = (init?.headers as Record<string, string> | undefined)?.authorization ?? '';
        return new Response('', { status: 202 });
      },
    });

    await runtime.enqueue(envelope(NODE_ID, 1), 100);
    expect((await outbox.get(`${NODE_ID}:1`))?.payload).toBeDefined();
    expect(JSON.stringify(await outbox.get(`${NODE_ID}:1`))).not.toContain(firstCredential);

    const result = await runtime.flush({ nowMs: 100 });
    expect(result).toEqual({ attempted: 1, delivered: 1, retryScheduled: 0, deadLettered: 0 });
    expect(authorization).toBe(`Konta2rNode ${firstCredential}`);
    expect(await outbox.count()).toBe(0);
  });

  it('uses a rotated vault credential for later queued data without rewriting old outbox records', async () => {
    const vault = new MemoryVault();
    const outbox = new MemoryOutbox();
    const sent: string[] = [];
    const runtime = createCommunityDeliveryRuntime({
      nodeId: NODE_ID,
      endpoint: 'https://example.test/ingest',
      vault,
      outbox,
      fetchImpl: async (_input, init) => {
        const authorization = (init?.headers as Record<string, string> | undefined)?.authorization;
        if (authorization !== undefined) sent.push(authorization);
        return new Response('', { status: 202 });
      },
    });

    await vault.put({ nodeId: NODE_ID, credential: credential(8), keyVersion: 1 });
    await runtime.enqueue(envelope(NODE_ID, 2), 200);
    await vault.put({ nodeId: NODE_ID, credential: credential(9), keyVersion: 2 });
    await runtime.flush({ nowMs: 200 });

    expect(sent).toEqual([`Konta2rNode ${credential(9)}`]);
  });

  it('dead-letters an upload when credential recovery is required and reports that state', async () => {
    const vault = new MemoryVault();
    const outbox = new MemoryOutbox();
    const runtime = createCommunityDeliveryRuntime({
      nodeId: NODE_ID,
      endpoint: 'https://example.test/ingest',
      vault,
      outbox,
      fetchImpl: async () => { throw new Error('must not fetch without credential'); },
    });

    await runtime.enqueue(envelope(NODE_ID, 3), 300);
    const result = await runtime.flush({ nowMs: 300 });
    expect(result.deadLettered).toBe(1);
    expect(await runtime.snapshot()).toEqual({
      nodeId: NODE_ID,
      credentialAvailable: false,
      pending: 0,
      deadLetter: 1,
    });
  });

  it('keeps network failures pending with retry scheduling for offline operation', async () => {
    const vault = new MemoryVault();
    const outbox = new MemoryOutbox();
    await vault.put({ nodeId: NODE_ID, credential: credential(12), keyVersion: 1 });
    const runtime = createCommunityDeliveryRuntime({
      nodeId: NODE_ID,
      endpoint: 'https://example.test/ingest',
      vault,
      outbox,
      fetchImpl: async () => { throw new Error('offline'); },
    });

    await runtime.enqueue(envelope(NODE_ID, 4), 400);
    const result = await runtime.flush({ nowMs: 400, randomUnit: () => 0.5 });
    expect(result.retryScheduled).toBe(1);
    const queued = await outbox.get(`${NODE_ID}:4`);
    expect(queued?.status).toBe('pending');
    expect(queued?.attempts).toBe(1);
    expect((queued?.nextAttemptAtMs ?? 0)).toBeGreaterThan(400);
  });
});
