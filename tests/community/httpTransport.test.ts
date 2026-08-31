import { describe, expect, it } from 'vitest';
import { createCommunityHttpSender } from '../../src/community/httpTransport';
import { computeNodeQuality } from '../../src/community/quality';
import type { CommunityUploadEnvelope } from '../../src/community/protocol';

function envelope(): CommunityUploadEnvelope {
  return {
    schemaVersion: '2.0',
    nodeId: 'node_transport1',
    sequence: 9,
    generatedAtIso: '2026-08-30T23:00:00.000Z',
    observedSegment: { segmentId: 'segment_1', source: 'konta2r' },
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
      uptimeRatio: 0.98,
      inferenceFpsP50: 5,
      inferenceLatencyP95Ms: 180,
      runtimeBackend: 'webgpu',
    },
    records: [{
      schemaVersion: '2.0',
      aggregateType: 'flow',
      bucketStartMs: 1_788_000_000_000,
      bucketEndMs: 1_788_000_300_000,
      entityType: 'car',
      direction: 'A_TO_B',
      count: 42,
      meanQuality: 0.9,
    }],
  };
}

describe('community HTTP transport', () => {
  it('sends idempotency and methodology headers without changing the payload', async () => {
    let capturedInit: RequestInit | undefined;
    const sender = createCommunityHttpSender({
      endpoint: 'https://example.test/community',
      accessToken: () => 'token-test',
      fetchImpl: async (_input, init) => {
        capturedInit = init;
        return new Response('', { status: 202 });
      },
    });

    const payload = envelope();
    const result = await sender(payload, 'node_transport1:9');
    const headers = capturedInit?.headers as Record<string, string> | undefined;

    expect(result.ok).toBe(true);
    expect(headers?.['idempotency-key']).toBe('node_transport1:9');
    expect(headers?.authorization).toBe('Bearer token-test');
    expect(headers?.['x-konta2r-methodology']).toBe('2.0');
    expect(JSON.parse(String(capturedInit?.body))).toEqual(payload);
  });

  it('treats overload/server responses as retryable', async () => {
    const sender = createCommunityHttpSender({
      endpoint: 'https://example.test/community',
      fetchImpl: async () => new Response('', { status: 503 }),
    });

    const result = await sender(envelope(), 'node_transport1:9');
    expect(result.ok).toBe(false);
    expect(result.retryable).toBe(true);
  });

  it('treats schema/client errors as permanent', async () => {
    const sender = createCommunityHttpSender({
      endpoint: 'https://example.test/community',
      fetchImpl: async () => new Response('', { status: 422 }),
    });

    const result = await sender(envelope(), 'node_transport1:9');
    expect(result.ok).toBe(false);
    expect(result.retryable).toBe(false);
  });

  it('treats network exceptions as retryable', async () => {
    const sender = createCommunityHttpSender({
      endpoint: 'https://example.test/community',
      fetchImpl: async () => { throw new Error('offline'); },
    });

    const result = await sender(envelope(), 'node_transport1:9');
    expect(result.ok).toBe(false);
    expect(result.retryable).toBe(true);
    expect(result.error).toBe('offline');
  });
});
