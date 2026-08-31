import { describe, expect, it } from 'vitest';
import { createNodeControlClient } from '../../src/backend/nodeControlClient';
import { generateNodeCredential } from '../../src/backend/nodeCredential';
import type { NodeCredentialSecret, NodeCredentialVault } from '../../src/backend/nodeCredentialVault';

const CONFIG = {
  url: 'https://example.supabase.co',
  publishableKey: 'sb_publishable_abcdefghijklmnopqrstuvwxyz',
};
const TOKEN = 'human-session-jwt';
const NODE_ID = 'node_control01';

function rawCredential(fill: number): string {
  return generateNodeCredential((bytes) => bytes.fill(fill));
}

class MemoryVault implements NodeCredentialVault {
  values = new Map<string, NodeCredentialSecret>();
  failPut = false;
  failDelete = false;

  async put(secret: NodeCredentialSecret): Promise<void> {
    if (this.failPut) throw new Error('storage failed');
    this.values.set(secret.nodeId, { ...secret });
  }

  async get(nodeId: string): Promise<NodeCredentialSecret | undefined> {
    const value = this.values.get(nodeId);
    return value ? { ...value } : undefined;
  }

  async delete(nodeId: string): Promise<void> {
    if (this.failDelete) throw new Error('delete failed');
    this.values.delete(nodeId);
  }

  async has(nodeId: string): Promise<boolean> {
    return this.values.has(nodeId);
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('node control client credential custody', () => {
  it('stores enrollment credential before returning only non-secret node metadata', async () => {
    const vault = new MemoryVault();
    const credential = rawCredential(3);
    let request: RequestInit | undefined;
    let url = '';
    const client = createNodeControlClient({
      config: CONFIG,
      accessToken: () => TOKEN,
      vault,
      fetchImpl: async (input, init) => {
        url = String(input);
        request = init;
        return jsonResponse({
          code: 'node_enrolled',
          node: { nodeId: NODE_ID, label: 'Ventana', segmentId: 'seg-1', status: 'provisioning' },
          credential,
          credentialVersion: 2,
        }, 201);
      },
    });

    const result = await client.enroll('Ventana', 'seg-1');
    expect(url).toBe('https://example.supabase.co/functions/v1/node-enroll');
    expect(request?.headers).toMatchObject({
      authorization: `Bearer ${TOKEN}`,
      apikey: CONFIG.publishableKey,
    });
    expect(JSON.parse(String(request?.body))).toEqual({ label: 'Ventana', segmentId: 'seg-1' });
    expect(await vault.get(NODE_ID)).toEqual({ nodeId: NODE_ID, credential, keyVersion: 2 });
    expect(result).toEqual({
      nodeId: NODE_ID,
      label: 'Ventana',
      segmentId: 'seg-1',
      status: 'provisioning',
      credentialVersion: 2,
      credentialStored: true,
    });
    expect(result).not.toHaveProperty('credential');
  });

  it('replaces vault material after a successful credential rotation', async () => {
    const vault = new MemoryVault();
    await vault.put({ nodeId: NODE_ID, credential: rawCredential(5), keyVersion: 1 });
    const nextCredential = rawCredential(7);
    const client = createNodeControlClient({
      config: CONFIG,
      accessToken: () => TOKEN,
      vault,
      fetchImpl: async () => jsonResponse({
        code: 'node_lifecycle_applied',
        node: { nodeId: NODE_ID, previousStatus: 'active', status: 'active' },
        credential: nextCredential,
        credentialVersion: 4,
      }),
    });

    const result = await client.lifecycle(NODE_ID, 'rotate');
    expect(await vault.get(NODE_ID)).toEqual({
      nodeId: NODE_ID,
      credential: nextCredential,
      keyVersion: 4,
    });
    expect(result.credentialStored).toBe(true);
    expect(result).not.toHaveProperty('credential');
  });

  it('deletes local credential only after server confirms revocation', async () => {
    const vault = new MemoryVault();
    const old = { nodeId: NODE_ID, credential: rawCredential(9), keyVersion: 1 };
    await vault.put(old);
    let success = false;
    const client = createNodeControlClient({
      config: CONFIG,
      accessToken: () => TOKEN,
      vault,
      fetchImpl: async () => success
        ? jsonResponse({
            code: 'node_lifecycle_applied',
            node: { nodeId: NODE_ID, previousStatus: 'active', status: 'revoked' },
          })
        : jsonResponse({ code: 'node_lifecycle_failed' }, 500),
    });

    await expect(client.lifecycle(NODE_ID, 'revoke')).rejects.toThrow('HTTP 500');
    expect(await vault.get(NODE_ID)).toEqual(old);

    success = true;
    await expect(client.lifecycle(NODE_ID, 'revoke')).resolves.toMatchObject({ status: 'revoked' });
    expect(await vault.get(NODE_ID)).toBeUndefined();
  });

  it('fails closed when human session or credential response is unavailable', async () => {
    const vault = new MemoryVault();
    const noSession = createNodeControlClient({
      config: CONFIG,
      accessToken: () => undefined,
      vault,
      fetchImpl: async () => { throw new Error('must not fetch'); },
    });
    await expect(noSession.enroll('Nodo', 'seg-1')).rejects.toThrow('session unavailable');

    const malformed = createNodeControlClient({
      config: CONFIG,
      accessToken: () => TOKEN,
      vault,
      fetchImpl: async () => jsonResponse({
        node: { nodeId: NODE_ID, status: 'provisioning' },
        credential: 'not-a-node-token',
        credentialVersion: 1,
      }),
    });
    await expect(malformed.enroll('Nodo', 'seg-1')).rejects.toThrow('credential material');
    expect(await vault.get(NODE_ID)).toBeUndefined();
  });

  it('does not expose raw credential in errors when local persistence fails', async () => {
    const vault = new MemoryVault();
    vault.failPut = true;
    const credential = rawCredential(13);
    const client = createNodeControlClient({
      config: CONFIG,
      accessToken: () => TOKEN,
      vault,
      fetchImpl: async () => jsonResponse({
        node: { nodeId: NODE_ID, previousStatus: 'paused', status: 'paused' },
        credential,
        credentialVersion: 2,
      }),
    });

    let message = '';
    try {
      await client.lifecycle(NODE_ID, 'rotate');
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain('could not be persisted locally');
    expect(message).not.toContain(credential);
  });
});
