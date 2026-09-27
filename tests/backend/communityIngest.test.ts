import { describe, expect, it } from 'vitest';
import {
  communityPayloadSha256,
  evaluateCommunityIngest,
  type CommunityIngestNodeState,
  type CommunityIngestPersistenceInput,
  type CommunityIngestPersistenceResult,
  type CommunityIngestStore,
} from '../../src/backend/communityIngest';
import {
  computeNodeCredentialHmac,
  generateNodeCredential,
} from '../../src/backend/nodeCredential';
import { computeNodeQuality } from '../../src/community/quality';
import type { CommunityUploadEnvelope } from '../../src/community/protocol';

const PEPPER = 'community-ingest-pepper-0123456789-abcdefghijklmnopqrstuvwxyz';
const NOW = Date.parse('2026-08-31T21:00:00.000Z');

function credential(): string {
  return generateNodeCredential((bytes) => bytes.fill(17));
}

function envelope(overrides: Partial<CommunityUploadEnvelope> = {}): CommunityUploadEnvelope {
  return {
    schemaVersion: '2.0',
    nodeId: 'node_ingest01',
    sequence: 12,
    generatedAtIso: '2026-08-31T20:55:00.000Z',
    observedSegment: { segmentId: 'segment_cycleway_1', source: 'konta2r' },
    softwareVersion: '2.0.0-alpha.1',
    methodologyVersion: '2.0',
    modelFingerprint: 'sha256:model-test',
    quality: computeNodeQuality({
      detection: 0.9,
      tracking: 0.92,
      temporal: 0.95,
      device: 0.88,
      validation: 0.85,
    }),
    runtime: {
      uptimeRatio: 0.97,
      inferenceFpsP50: 5.2,
      inferenceLatencyP95Ms: 190,
      runtimeBackend: 'webgpu',
    },
    records: [{
      schemaVersion: '2.0',
      aggregateType: 'flow',
      bucketStartMs: NOW - 10 * 60_000,
      bucketEndMs: NOW - 5 * 60_000,
      entityType: 'cyclist',
      direction: 'A_TO_B',
      count: 18,
      meanQuality: 0.91,
    }],
    ...overrides,
  };
}

class MemoryIngestStore implements CommunityIngestStore {
  node: CommunityIngestNodeState | undefined;
  persistCalls = 0;
  readonly batches = new Map<string, { batchId: string; payloadSha256: string }>();

  async getNodeState(): Promise<CommunityIngestNodeState | undefined> {
    return this.node;
  }

  async persistCommunityUpload(
    input: CommunityIngestPersistenceInput,
  ): Promise<CommunityIngestPersistenceResult> {
    this.persistCalls += 1;
    const key = `${input.envelope.nodeId}:${input.envelope.sequence}`;
    const existing = this.batches.get(key);
    if (existing) {
      return existing.payloadSha256 === input.payloadSha256
        ? {
            outcome: 'duplicate',
            batchId: existing.batchId,
            existingPayloadSha256: existing.payloadSha256,
          }
        : {
            outcome: 'sequence_conflict',
            batchId: existing.batchId,
            existingPayloadSha256: existing.payloadSha256,
          };
    }
    const batchId = `batch_${this.batches.size + 1}`;
    this.batches.set(key, { batchId, payloadSha256: input.payloadSha256 });
    return { outcome: 'inserted', batchId };
  }
}

async function fixtureNode(
  token: string,
  overrides: Partial<CommunityIngestNodeState> = {},
): Promise<CommunityIngestNodeState> {
  return {
    nodeId: 'node_ingest01',
    status: 'active',
    segmentId: 'segment_cycleway_1',
    credentialHmac: await computeNodeCredentialHmac(token, PEPPER),
    keyVersion: 1,
    ...overrides,
  };
}

async function dependencies(store: MemoryIngestStore) {
  return {
    store,
    pepperForKeyVersion: (version: number) => version === 1 ? PEPPER : undefined,
    nowMs: () => NOW,
  };
}

function request(token: string, body: CommunityUploadEnvelope = envelope()) {
  return {
    authorization: `Konta2rNode ${token}`,
    idempotencyKey: `${body.nodeId}:${body.sequence}`,
    body,
  };
}

describe('community ingest contract', () => {
  it('accepts an authenticated aggregate upload bound to the configured segment', async () => {
    const token = credential();
    const store = new MemoryIngestStore();
    store.node = await fixtureNode(token);

    const decision = await evaluateCommunityIngest(request(token), await dependencies(store));

    expect(decision).toEqual({
      statusCode: 202,
      outcome: 'accepted',
      code: 'community_upload_accepted',
      batchId: 'batch_1',
    });
    expect(store.persistCalls).toBe(1);
  });

  it('accepts an identical replay idempotently but rejects the same sequence with altered data', async () => {
    const token = credential();
    const store = new MemoryIngestStore();
    store.node = await fixtureNode(token);
    const deps = await dependencies(store);
    const original = envelope();

    expect((await evaluateCommunityIngest(request(token, original), deps)).statusCode).toBe(202);
    const duplicate = await evaluateCommunityIngest(request(token, original), deps);
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.outcome).toBe('duplicate');

    const originalRecord = original.records[0];
    if (!originalRecord || originalRecord.aggregateType !== 'flow') {
      throw new Error('Expected flow fixture');
    }
    const altered = envelope({
      records: [{
        ...originalRecord,
        count: 999,
      }],
    });
    const conflict = await evaluateCommunityIngest(request(token, altered), deps);
    expect(conflict.statusCode).toBe(409);
    expect(conflict.code).toBe('sequence_payload_conflict');
  });

  it('hashes canonical JSON independently of object insertion order', async () => {
    const left = envelope();
    const right = {
      records: left.records,
      runtime: left.runtime,
      quality: left.quality,
      modelFingerprint: left.modelFingerprint,
      methodologyVersion: left.methodologyVersion,
      softwareVersion: left.softwareVersion,
      observedSegment: left.observedSegment,
      generatedAtIso: left.generatedAtIso,
      sequence: left.sequence,
      nodeId: left.nodeId,
      schemaVersion: left.schemaVersion,
    } satisfies CommunityUploadEnvelope;

    expect(await communityPayloadSha256(left)).toBe(await communityPayloadSha256(right));
  });

  it('never accepts a human Bearer/JWT token as sensor authentication', async () => {
    const token = credential();
    const store = new MemoryIngestStore();
    store.node = await fixtureNode(token);

    const decision = await evaluateCommunityIngest({
      authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.human-session',
      idempotencyKey: 'node_ingest01:12',
      body: envelope(),
    }, await dependencies(store));

    expect(decision).toEqual({
      statusCode: 401,
      outcome: 'rejected',
      code: 'invalid_node_auth',
    });
    expect(store.persistCalls).toBe(0);
  });

  it('rejects a valid credential when the upload claims another segment', async () => {
    const token = credential();
    const store = new MemoryIngestStore();
    store.node = await fixtureNode(token);
    const body = envelope({
      observedSegment: { segmentId: 'segment_other', source: 'konta2r' },
    });

    const decision = await evaluateCommunityIngest(request(token, body), await dependencies(store));
    expect(decision.statusCode).toBe(403);
    expect(decision.code).toBe('segment_not_authorized');
    expect(store.persistCalls).toBe(0);
  });

  it('fails closed for revoked, paused and expired nodes', async () => {
    const token = credential();

    for (const state of [
      { status: 'revoked' as const },
      { status: 'paused' as const },
      { credentialExpiresAtMs: NOW - 1 },
    ]) {
      const store = new MemoryIngestStore();
      store.node = await fixtureNode(token, state);
      const decision = await evaluateCommunityIngest(request(token), await dependencies(store));
      expect([401, 403]).toContain(decision.statusCode);
      expect(store.persistCalls).toBe(0);
    }
  });

  it('rejects a mismatched idempotency key before persistence', async () => {
    const token = credential();
    const store = new MemoryIngestStore();
    store.node = await fixtureNode(token);

    const decision = await evaluateCommunityIngest({
      ...request(token),
      idempotencyKey: 'node_ingest01:999',
    }, await dependencies(store));

    expect(decision.statusCode).toBe(400);
    expect(decision.code).toBe('idempotency_key_mismatch');
    expect(store.persistCalls).toBe(0);
  });

  it('returns a retryable server-side configuration failure when the credential key version is unavailable', async () => {
    const token = credential();
    const store = new MemoryIngestStore();
    store.node = await fixtureNode(token, { keyVersion: 2 });

    const decision = await evaluateCommunityIngest(request(token), await dependencies(store));
    expect(decision.statusCode).toBe(503);
    expect(decision.code).toBe('credential_key_unavailable');
    expect(store.persistCalls).toBe(0);
  });
});
