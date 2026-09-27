import { describe, expect, it } from 'vitest';
import {
  communityPayloadSha256,
  createNodeCredentialVerifier,
  parseCommunityUploadJson,
  processCommunityIngestion,
  type CommunityIngestionStore,
  type NodeCredentialRow,
  type PreparedCommunityBatch,
} from '../../src/backend/communityIngestion';
import {
  computeNodeCredentialHmac,
  generateNodeCredential,
  type SecureRandomFill,
} from '../../src/backend/nodeCredential';
import { computeNodeQuality } from '../../src/community/quality';
import type { CommunityUploadEnvelope } from '../../src/community/protocol';

const NOW_MS = Date.parse('2026-09-01T04:00:00.000Z');
const SEGMENT_ID = 'osm_way_123:segment_4';
const PEPPER = 'community-ingestion-pepper-0123456789-abcdefghijklmnopqrstuvwxyz';

function deterministicFill(seed = 0): SecureRandomFill {
  let cursor = seed;
  return (bytes) => {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = cursor & 0xff;
      cursor += 1;
    }
  };
}

const CREDENTIAL = generateNodeCredential(deterministicFill(21));

function validEnvelope(): CommunityUploadEnvelope {
  return {
    schemaVersion: '2.0',
    nodeId: 'node_abc12345',
    sequence: 42,
    generatedAtIso: '2026-09-01T03:55:00.000Z',
    observedSegment: {
      segmentId: SEGMENT_ID,
      source: 'osm',
      sourceVersion: '2026-08',
    },
    softwareVersion: '2.0.0-alpha.1',
    methodologyVersion: '2.0',
    modelFingerprint: 'sha256:example',
    quality: computeNodeQuality({
      detection: 0.9,
      tracking: 0.88,
      temporal: 0.95,
      device: 0.9,
      validation: 0.86,
    }),
    runtime: {
      uptimeRatio: 0.98,
      inferenceFpsP50: 5.1,
      inferenceLatencyP95Ms: 180,
      droppedFrameRatio: 0.04,
      runtimeBackend: 'wasm',
    },
    records: [{
      schemaVersion: '2.0',
      aggregateType: 'flow',
      bucketStartMs: NOW_MS - 600_000,
      bucketEndMs: NOW_MS - 300_000,
      entityType: 'cyclist',
      direction: 'A_TO_B',
      count: 12,
      meanQuality: 0.87,
    }],
  };
}

function body(envelope = validEnvelope()): string {
  return JSON.stringify(envelope);
}

function headers(envelope = validEnvelope(), credential = CREDENTIAL): Record<string, string> {
  return {
    'content-type': 'application/json; charset=utf-8',
    authorization: `Konta2rNode ${credential}`,
    'idempotency-key': `${envelope.nodeId}:${envelope.sequence}`,
    'x-konta2r-schema': envelope.schemaVersion,
    'x-konta2r-methodology': envelope.methodologyVersion,
  };
}

class FakeStore implements CommunityIngestionStore {
  readonly batches: PreparedCommunityBatch[] = [];
  mode: 'inserted' | 'duplicate_same_payload' | 'conflict' = 'inserted';

  async persist(batch: PreparedCommunityBatch) {
    this.batches.push(batch);
    if (this.mode === 'conflict') {
      return { status: 'conflict' as const, existingPayloadSha256: 'f'.repeat(64) };
    }
    return {
      status: this.mode,
      batchId: 'batch-1',
    };
  }
}

function acceptingVerifier(segmentId = SEGMENT_ID) {
  return async (nodeId: string) => ({
    authorized: true as const,
    node: { nodeId, segmentId },
  });
}

describe('community ingestion trust boundary', () => {
  it('parses an exact aggregate-only envelope and hashes the received bytes', () => {
    const serialized = body();
    expect(parseCommunityUploadJson(serialized)).toEqual(validEnvelope());
    expect(communityPayloadSha256(serialized)).toMatch(/^[a-f0-9]{64}$/);
    expect(communityPayloadSha256(serialized)).not.toBe(communityPayloadSha256(`${serialized}\n`));
  });

  it('rejects unknown fields instead of silently accepting protocol drift', () => {
    const unsafe = { ...validEnvelope(), cameraAddress: 'home' };
    expect(() => parseCommunityUploadJson(JSON.stringify(unsafe))).toThrow('invalid_payload_shape');
  });

  it('accepts one authenticated insert and passes a byte-level payload hash to persistence', async () => {
    const envelope = validEnvelope();
    const serialized = body(envelope);
    const store = new FakeStore();
    const result = await processCommunityIngestion({
      method: 'POST',
      headers: headers(envelope),
      bodyText: serialized,
    }, acceptingVerifier(), store, { nowMs: NOW_MS });

    expect(result).toEqual({
      ok: true,
      statusCode: 201,
      disposition: 'inserted',
      batchId: 'batch-1',
      payloadSha256: communityPayloadSha256(serialized),
    });
    expect(store.batches).toHaveLength(1);
    expect(store.batches[0]?.nodeId).toBe(envelope.nodeId);
    expect(store.batches[0]?.sequence).toBe(envelope.sequence);
  });

  it('treats the exact same node sequence and payload as an idempotent duplicate', async () => {
    const envelope = validEnvelope();
    const store = new FakeStore();
    store.mode = 'duplicate_same_payload';
    const result = await processCommunityIngestion({
      method: 'POST', headers: headers(envelope), bodyText: body(envelope),
    }, acceptingVerifier(), store, { nowMs: NOW_MS });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.statusCode).toBe(200);
      expect(result.disposition).toBe('duplicate');
    }
  });

  it('rejects re-use of a node sequence for different bytes', async () => {
    const envelope = validEnvelope();
    const store = new FakeStore();
    store.mode = 'conflict';
    const result = await processCommunityIngestion({
      method: 'POST', headers: headers(envelope), bodyText: body(envelope),
    }, acceptingVerifier(), store, { nowMs: NOW_MS });
    expect(result).toEqual({ ok: false, statusCode: 409, code: 'idempotency_conflict' });
  });

  it('rejects an idempotency header that does not bind nodeId and sequence', async () => {
    const envelope = validEnvelope();
    const requestHeaders = headers(envelope);
    requestHeaders['idempotency-key'] = `${envelope.nodeId}:43`;
    const store = new FakeStore();
    const result = await processCommunityIngestion({
      method: 'POST', headers: requestHeaders, bodyText: body(envelope),
    }, acceptingVerifier(), store, { nowMs: NOW_MS });
    expect(result).toEqual({ ok: false, statusCode: 409, code: 'idempotency_mismatch' });
    expect(store.batches).toHaveLength(0);
  });

  it('never accepts Bearer/user JWT syntax as a long-running node credential', async () => {
    const envelope = validEnvelope();
    const requestHeaders = headers(envelope);
    requestHeaders.authorization = `Bearer ${CREDENTIAL}`;
    const result = await processCommunityIngestion({
      method: 'POST', headers: requestHeaders, bodyText: body(envelope),
    }, acceptingVerifier(), new FakeStore(), { nowMs: NOW_MS });
    expect(result).toEqual({ ok: false, statusCode: 401, code: 'invalid_authorization' });
  });

  it('binds an authenticated sensor to its enrolled observed segment', async () => {
    const envelope = validEnvelope();
    const store = new FakeStore();
    const result = await processCommunityIngestion({
      method: 'POST', headers: headers(envelope), bodyText: body(envelope),
    }, acceptingVerifier('osm_way_other:segment_1'), store, { nowMs: NOW_MS });
    expect(result).toEqual({ ok: false, statusCode: 403, code: 'segment_mismatch' });
    expect(store.batches).toHaveLength(0);
  });

  it('rejects future-dated uploads beyond the clock-skew allowance', async () => {
    const envelope = validEnvelope();
    envelope.generatedAtIso = new Date(NOW_MS + 11 * 60_000).toISOString();
    const result = await processCommunityIngestion({
      method: 'POST', headers: headers(envelope), bodyText: body(envelope),
    }, acceptingVerifier(), new FakeStore(), { nowMs: NOW_MS });
    expect(result).toEqual({ ok: false, statusCode: 422, code: 'future_generated_at' });
  });

  it('enforces body, content-type and protocol-header boundaries before persistence', async () => {
    const envelope = validEnvelope();
    const store = new FakeStore();
    const wrongType = await processCommunityIngestion({
      method: 'POST',
      headers: { ...headers(envelope), 'content-type': 'text/plain' },
      bodyText: body(envelope),
    }, acceptingVerifier(), store, { nowMs: NOW_MS });
    expect(wrongType).toEqual({ ok: false, statusCode: 415, code: 'invalid_content_type' });

    const wrongMethodology = await processCommunityIngestion({
      method: 'POST',
      headers: { ...headers(envelope), 'x-konta2r-methodology': 'other' },
      bodyText: body(envelope),
    }, acceptingVerifier(), store, { nowMs: NOW_MS });
    expect(wrongMethodology).toEqual({
      ok: false, statusCode: 422, code: 'invalid_payload_shape', detail: 'protocol headers do not match payload',
    });

    const tooLarge = await processCommunityIngestion({
      method: 'POST', headers: headers(envelope), bodyText: body(envelope),
    }, acceptingVerifier(), store, { nowMs: NOW_MS, maxBodyBytes: 1024 });
    expect(tooLarge).toEqual({ ok: false, statusCode: 413, code: 'payload_too_large' });
    expect(store.batches).toHaveLength(0);
  });
});

describe('node credential verifier', () => {
  it('authorizes only an active, unexpired row with the matching HMAC and returns its segment binding', async () => {
    const credentialHmac = await computeNodeCredentialHmac(CREDENTIAL, PEPPER);
    const row: NodeCredentialRow = {
      nodeId: 'node_abc12345',
      segmentId: SEGMENT_ID,
      credentialHmac,
      keyVersion: 1,
      nodeStatus: 'active',
    };
    const verifier = createNodeCredentialVerifier(
      async (nodeId) => nodeId === row.nodeId ? row : undefined,
      () => PEPPER,
      () => NOW_MS,
    );
    await expect(verifier(row.nodeId, CREDENTIAL)).resolves.toEqual({
      authorized: true,
      node: { nodeId: row.nodeId, segmentId: SEGMENT_ID },
    });
  });

  it('fails closed with the same public result for wrong token, paused, revoked, expired and unknown nodes', async () => {
    const credentialHmac = await computeNodeCredentialHmac(CREDENTIAL, PEPPER);
    const base: NodeCredentialRow = {
      nodeId: 'node_abc12345', segmentId: SEGMENT_ID, credentialHmac, keyVersion: 1, nodeStatus: 'active',
    };
    const cases: Array<NodeCredentialRow | undefined> = [
      { ...base, nodeStatus: 'paused' },
      { ...base, revokedAtMs: NOW_MS - 1 },
      { ...base, expiresAtMs: NOW_MS },
      undefined,
    ];
    for (const row of cases) {
      const verifier = createNodeCredentialVerifier(async () => row, () => PEPPER, () => NOW_MS);
      await expect(verifier(base.nodeId, CREDENTIAL)).resolves.toEqual({ authorized: false });
    }
    const wrong = generateNodeCredential(deterministicFill(90));
    const verifier = createNodeCredentialVerifier(async () => base, () => PEPPER, () => NOW_MS);
    await expect(verifier(base.nodeId, wrong)).resolves.toEqual({ authorized: false });
  });
});