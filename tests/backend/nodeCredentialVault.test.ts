import { describe, expect, it } from 'vitest';
import {
  createVaultBackedNodeCredentialProvider,
  decryptNodeCredentialSecret,
  encryptNodeCredentialSecret,
  generateNodeCredentialVaultKey,
  type NodeCredentialSecret,
  type NodeCredentialVault,
} from '../../src/backend/nodeCredentialVault';
import { generateNodeCredential } from '../../src/backend/nodeCredential';

const NODE_ID = 'node_vaulttest01';

function credential(fill: number): string {
  return generateNodeCredential((bytes) => bytes.fill(fill));
}

function secret(fill = 7): NodeCredentialSecret {
  return {
    nodeId: NODE_ID,
    credential: credential(fill),
    keyVersion: 3,
  };
}

class MemoryVault implements NodeCredentialVault {
  value: NodeCredentialSecret | undefined;

  async put(value: NodeCredentialSecret): Promise<void> {
    this.value = { ...value };
  }

  async get(nodeId: string): Promise<NodeCredentialSecret | undefined> {
    return this.value?.nodeId === nodeId ? { ...this.value } : undefined;
  }

  async delete(nodeId: string): Promise<void> {
    if (this.value?.nodeId === nodeId) this.value = undefined;
  }

  async has(nodeId: string): Promise<boolean> {
    return this.value?.nodeId === nodeId;
  }
}

describe('node credential vault cryptography', () => {
  it('uses a non-extractable AES-GCM key and round-trips the credential', async () => {
    const key = await generateNodeCredentialVaultKey();
    expect(key.algorithm.name).toBe('AES-GCM');
    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow();

    const input = secret();
    const record = await encryptNodeCredentialSecret(input, key, {
      randomFill: (bytes) => bytes.fill(11),
      nowMs: 1234,
    });
    expect(record.nodeId).toBe(input.nodeId);
    expect(record.keyVersion).toBe(input.keyVersion);
    expect(record.storedAtMs).toBe(1234);
    expect(record.iv).toHaveLength(12);
    expect(new TextDecoder().decode(record.ciphertext)).not.toContain(input.credential);
    expect(await decryptNodeCredentialSecret(record, key)).toEqual(input);
  });

  it('binds ciphertext to nodeId and keyVersion through authenticated data', async () => {
    const key = await generateNodeCredentialVaultKey();
    const record = await encryptNodeCredentialSecret(secret(), key, {
      randomFill: (bytes) => bytes.fill(17),
    });

    await expect(decryptNodeCredentialSecret({
      ...record,
      nodeId: 'node_othernode01',
    }, key)).rejects.toThrow();

    await expect(decryptNodeCredentialSecret({
      ...record,
      keyVersion: record.keyVersion + 1,
    }, key)).rejects.toThrow();
  });

  it('rejects the wrong encryption key and malformed encrypted records', async () => {
    const key = await generateNodeCredentialVaultKey();
    const wrongKey = await generateNodeCredentialVaultKey();
    const record = await encryptNodeCredentialSecret(secret(), key);

    await expect(decryptNodeCredentialSecret(record, wrongKey)).rejects.toThrow();
    await expect(decryptNodeCredentialSecret({
      ...record,
      iv: new Uint8Array(4),
    }, key)).rejects.toThrow('IV');
  });

  it('uses fresh IVs so repeated persistence does not create deterministic ciphertext', async () => {
    const key = await generateNodeCredentialVaultKey();
    let seed = 1;
    const randomFill = (bytes: Uint8Array<ArrayBuffer>) => bytes.fill(seed++);
    const first = await encryptNodeCredentialSecret(secret(), key, { randomFill });
    const second = await encryptNodeCredentialSecret(secret(), key, { randomFill });

    expect([...first.iv]).not.toEqual([...second.iv]);
    expect([...first.ciphertext]).not.toEqual([...second.ciphertext]);
  });

  it('exposes only a late-bound credential provider to Community transport', async () => {
    const vault = new MemoryVault();
    const provider = createVaultBackedNodeCredentialProvider(vault, NODE_ID);
    expect(await provider()).toBeUndefined();

    const current = secret(23);
    await vault.put(current);
    expect(await provider()).toBe(current.credential);

    await vault.delete(NODE_ID);
    expect(await provider()).toBeUndefined();
  });
});
