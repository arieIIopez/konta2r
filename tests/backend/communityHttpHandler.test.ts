import { describe, expect, it } from 'vitest';
import {
  createCommunityHttpHandler,
  type CommunityHttpHandlerLogger,
  type CommunityHttpRequestLike,
} from '../../src/backend/communityHttpHandler';
import type {
  CommunityIngestionStore,
  NodeCredentialVerifier,
  PreparedCommunityBatch,
} from '../../src/backend/communityIngestion';
import { generateNodeCredential, type SecureRandomFill } from '../../src/backend/nodeCredential';
import { computeNodeQuality } from '../../src/community/quality';
import type { CommunityUploadEnvelope } from '../../src/community/protocol';

const ORIGIN = 'https://konta2r.example';
const NOW_MS = Date.parse('2026-09-01T05:15:00.000Z');

function deterministicFill(seed = 0): SecureRandomFill {
  let cursor = seed;
  return (bytes) => {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = cursor & 0xff;
      cursor += 1;
    }
  };
}

const CREDENTIAL = generateNodeCredential(deterministicFill(8));

function envelope(): CommunityUploadEnvelope {
  return {
    schemaVersion: '2.0',
    nodeId: 'node_abc12345',
    sequence: 7,
    generatedAtIso: '2026-09-01T05:10:00.000Z',
    observedSegment: { segmentId: 'osm_way_1:segment_2', source: 'osm' },
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
      inferenceFpsP50: 5,
      inferenceLatencyP95Ms: 180,
      runtimeBackend: 'wasm',
    },
    records: [{
      schemaVersion: '2.0',
      aggregateType: 'flow',
      bucketStartMs: NOW_MS - 600_000,
      bucketEndMs: NOW_MS - 300_000,
      entityType: 'cyclist',
      direction: 'A_TO_B',
      count: 4,
      meanQuality: 0.84,
    }],
  };
}

function request(
  overrides: Partial<{ method: string; origin: string | null; body: string; headers: Record<string, string> }> = {},
): CommunityHttpRequestLike {
  const payload = envelope();
  const body = overrides.body ?? JSON.stringify(payload);
  const headers = new Headers({
    'content-type': 'application/json',
    authorization: `Konta2rNode ${CREDENTIAL}`,
    'idempotency-key': `${payload.nodeId}:${payload.sequence}`,
    'x-konta2r-schema': payload.schemaVersion,
    'x-konta2r-methodology': payload.methodologyVersion,
    ...(overrides.origin === null ? {} : { origin: overrides.origin ?? ORIGIN }),
    ...overrides.headers,
  });
  return {
    method: overrides.method ?? 'POST',
    headers,
    text: async () => body,
  };
}

function verifier(): NodeCredentialVerifier {
  return async (nodeId, credential) => ({
    authorized: credential === CREDENTIAL,
    ...(credential === CREDENTIAL
      ? { node: { nodeId, segmentId: 'osm_way_1:segment_2' } }
      : {}),
  } as Awaited<ReturnType<NodeCredentialVerifier>>);
}

class Store implements CommunityIngestionStore {
  calls = 0;
  async persist(_batch: PreparedCommunityBatch) {
    this.calls += 1;
    return { status: 'inserted' as const, batchId: 'batch-7' };
  }
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return JSON.parse(await response.text()) as Record<string, unknown>;
}

class Logger implements CommunityHttpHandlerLogger {
  readonly events: Array<{ event: string; error: unknown }> = [];
  error(event: string, error: unknown): void {
    this.events.push({ event, error });
  }
}

describe('Community HTTP handler', () => {
  it('answers an allowed browser preflight without invoking authentication or persistence', async () => {
    let verifierCalls = 0;
    const store = new Store();
    const handler = createCommunityHttpHandler(async () => {
      verifierCalls += 1;
      return { authorized: false };
    }, store, { allowedOrigins: [ORIGIN] });

    const response = await handler(request({ method: 'OPTIONS', body: '' }));
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(response.headers.get('access-control-allow-methods')).toBe('POST, OPTIONS');
    expect(response.headers.get('access-control-allow-headers')).toContain('idempotency-key');
    expect(response.headers.get('access-control-allow-headers')).toContain('x-konta2r-methodology');
    expect(response.headers.get('access-control-allow-credentials')).toBeNull();
    expect(verifierCalls).toBe(0);
    expect(store.calls).toBe(0);
  });

  it('rejects a browser origin outside the allowlist before reading the request body', async () => {
    let bodyReads = 0;
    const req = request({ origin: 'https://evil.example' });
    req.text = async () => {
      bodyReads += 1;
      return JSON.stringify(envelope());
    };
    const handler = createCommunityHttpHandler(verifier(), new Store(), { allowedOrigins: [ORIGIN] });
    const response = await handler(req);

    expect(response.status).toBe(403);
    expect(await json(response)).toEqual({ error: 'origin_not_allowed' });
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(bodyReads).toBe(0);
  });

  it('accepts a valid browser upload and returns only the persisted batch identity', async () => {
    const store = new Store();
    const handler = createCommunityHttpHandler(verifier(), store, {
      allowedOrigins: [ORIGIN],
      nowMs: () => NOW_MS,
    });
    const response = await handler(request());

    expect(response.status).toBe(201);
    expect(response.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await json(response)).toMatchObject({
      status: 'inserted',
      batchId: 'batch-7',
    });
    expect(String((await json(new Response(JSON.stringify({ ok: true })))).ok)).toBe('true');
    expect(store.calls).toBe(1);
  });

  it('allows non-browser clients with no Origin while keeping node authentication mandatory', async () => {
    const handler = createCommunityHttpHandler(verifier(), new Store(), {
      allowedOrigins: [ORIGIN],
      nowMs: () => NOW_MS,
    });
    const response = await handler(request({ origin: null }));
    expect(response.status).toBe(201);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('preserves expected client failure status codes without reflecting internal payload details', async () => {
    const payload = envelope();
    const headers = {
      'idempotency-key': `${payload.nodeId}:999`,
    };
    const handler = createCommunityHttpHandler(verifier(), new Store(), {
      allowedOrigins: [ORIGIN],
      nowMs: () => NOW_MS,
    });
    const response = await handler(request({ headers }));
    expect(response.status).toBe(409);
    expect(await json(response)).toEqual({ error: 'idempotency_mismatch' });
  });

  it('uses Content-Length as an early reject but still relies on the ingestion layer for actual byte validation', async () => {
    let bodyReads = 0;
    const req = request({ headers: { 'content-length': '9999999' } });
    req.text = async () => {
      bodyReads += 1;
      return JSON.stringify(envelope());
    };
    const handler = createCommunityHttpHandler(verifier(), new Store(), {
      allowedOrigins: [ORIGIN],
      maxBodyBytes: 2048,
      nowMs: () => NOW_MS,
    });
    const response = await handler(req);
    expect(response.status).toBe(413);
    expect(await json(response)).toEqual({ error: 'payload_too_large' });
    expect(bodyReads).toBe(0);
  });

  it('sanitizes verifier/store failures as 500 while preserving diagnostics only in the injected logger', async () => {
    const logger = new Logger();
    const secret = 'database password should never be reflected';
    const failingVerifier: NodeCredentialVerifier = async () => {
      throw new Error(secret);
    };
    const handler = createCommunityHttpHandler(failingVerifier, new Store(), {
      allowedOrigins: [ORIGIN],
      nowMs: () => NOW_MS,
      logger,
    });
    const response = await handler(request());
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(JSON.parse(text)).toEqual({ error: 'internal_error' });
    expect(text).not.toContain(secret);
    expect(logger.events).toHaveLength(1);
    expect(logger.events[0]?.event).toBe('community_ingestion_internal_failure');
    expect((logger.events[0]?.error as Error).message).toBe(secret);
  });

  it('sanitizes body-read failures before any ingestion logic runs', async () => {
    const logger = new Logger();
    const req = request();
    req.text = async () => { throw new Error('stream failure'); };
    const handler = createCommunityHttpHandler(verifier(), new Store(), {
      allowedOrigins: [ORIGIN],
      logger,
    });
    const response = await handler(req);
    expect(response.status).toBe(500);
    expect(await json(response)).toEqual({ error: 'internal_error' });
    expect(logger.events[0]?.event).toBe('community_request_body_read_failed');
  });

  it('rejects unsafe CORS configuration at composition time', () => {
    expect(() => createCommunityHttpHandler(verifier(), new Store(), { allowedOrigins: [] }))
      .toThrow('at least one allowed browser origin');
    expect(() => createCommunityHttpHandler(verifier(), new Store(), {
      allowedOrigins: ['http://remote.example'],
    })).toThrow('HTTPS');
    expect(() => createCommunityHttpHandler(verifier(), new Store(), {
      allowedOrigins: ['https://konta2r.example/path'],
    })).toThrow('origins without paths');
    expect(() => createCommunityHttpHandler(verifier(), new Store(), {
      allowedOrigins: ['http://localhost:5173'],
    })).not.toThrow();
  });
});
