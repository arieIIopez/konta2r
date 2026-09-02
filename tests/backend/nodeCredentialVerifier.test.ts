import { describe, expect, it } from 'vitest';
import {
  computeNodeCredentialHmac,
  generateNodeCredential,
  type SecureRandomFill,
} from '../../src/backend/nodeCredential';
import {
  createCryptographicNodeCredentialVerifier,
  type NodePepperProvider,
} from '../../src/backend/nodeCredentialVerifier';
import type { NodeCredentialRow } from '../../src/backend/communityIngestion';

const NOW_MS = Date.parse('2026-09-01T05:00:00.000Z');
const PEPPER = 'verification-pepper-0123456789-abcdefghijklmnopqrstuvwxyz';

function deterministicFill(seed = 0): SecureRandomFill {
  let cursor = seed;
  return (bytes) => {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = cursor & 0xff;
      cursor += 1;
    }
  };
}

const CREDENTIAL = generateNodeCredential(deterministicFill(11));

async function activeRow(): Promise<NodeCredentialRow> {
  return {
    nodeId: 'node_abc12345',
    segmentId: 'osm_way_123:segment_4',
    credentialHmac: await computeNodeCredentialHmac(CREDENTIAL, PEPPER),
    keyVersion: 3,
    nodeStatus: 'active',
  };
}

class RecordingPepperProvider implements NodePepperProvider {
  readonly versions: number[] = [];
  constructor(private readonly pepper = PEPPER) {}

  getPepper(keyVersion: number): string {
    this.versions.push(keyVersion);
    return this.pepper;
  }
}

describe('cryptographic node credential verifier', () => {
  it('authorizes a matching active credential using its stored key version', async () => {
    const row = await activeRow();
    const peppers = new RecordingPepperProvider();
    const verifier = createCryptographicNodeCredentialVerifier(
      async (nodeId) => nodeId === row.nodeId ? row : undefined,
      peppers,
      () => NOW_MS,
    );

    await expect(verifier(row.nodeId, CREDENTIAL)).resolves.toEqual({
      authorized: true,
      node: {
        nodeId: row.nodeId,
        segmentId: row.segmentId,
      },
    });
    expect(peppers.versions).toEqual([3]);
  });

  it('returns the same unauthorized result for a valid-format but incorrect credential', async () => {
    const row = await activeRow();
    const wrongCredential = generateNodeCredential(deterministicFill(90));
    const peppers = new RecordingPepperProvider();
    const verifier = createCryptographicNodeCredentialVerifier(async () => row, peppers, () => NOW_MS);

    await expect(verifier(row.nodeId, wrongCredential)).resolves.toEqual({ authorized: false });
    expect(peppers.versions).toEqual([3]);
  });

  it('rejects inactive, revoked and expired rows before requesting the secret pepper', async () => {
    const base = await activeRow();
    const cases: NodeCredentialRow[] = [
      { ...base, nodeStatus: 'paused' },
      { ...base, nodeStatus: 'revoked' },
      { ...base, revokedAtMs: NOW_MS - 1 },
      { ...base, expiresAtMs: NOW_MS },
      { ...base, credentialHmac: 'invalid' },
      { ...base, keyVersion: 0 },
    ];

    for (const row of cases) {
      const peppers = new RecordingPepperProvider();
      const verifier = createCryptographicNodeCredentialVerifier(async () => row, peppers, () => NOW_MS);
      await expect(verifier(base.nodeId, CREDENTIAL)).resolves.toEqual({ authorized: false });
      expect(peppers.versions).toEqual([]);
    }
  });

  it('does not query storage for malformed node ids or human/session-like credentials', async () => {
    let lookups = 0;
    const peppers = new RecordingPepperProvider();
    const verifier = createCryptographicNodeCredentialVerifier(async () => {
      lookups += 1;
      return undefined;
    }, peppers, () => NOW_MS);

    await expect(verifier('home@example.com', CREDENTIAL)).resolves.toEqual({ authorized: false });
    await expect(verifier('node_abc12345', 'eyJhbGciOiJIUzI1NiJ9.jwt')).resolves.toEqual({ authorized: false });
    expect(lookups).toBe(0);
    expect(peppers.versions).toEqual([]);
  });

  it('propagates database and secret-provider failures for generic 5xx handling instead of returning a false 401', async () => {
    const row = await activeRow();
    const dbFailure = createCryptographicNodeCredentialVerifier(async () => {
      throw new Error('database unavailable');
    }, new RecordingPepperProvider(), () => NOW_MS);
    await expect(dbFailure(row.nodeId, CREDENTIAL)).rejects.toThrow('database unavailable');

    const secretFailure = createCryptographicNodeCredentialVerifier(
      async () => row,
      { getPepper: () => { throw new Error('secret unavailable'); } },
      () => NOW_MS,
    );
    await expect(secretFailure(row.nodeId, CREDENTIAL)).rejects.toThrow('secret unavailable');
  });
});
