import { describe, expect, it } from 'vitest';
import {
  computeNodeCredentialHmac,
  createNodeCredentialMaterial,
  createNodeEnrollmentMaterial,
  generateNodeCredential,
  generatePseudonymousNodeId,
  isValidNodeCredential,
  isValidNodeId,
  type SecureRandomFill,
} from '../../src/backend/nodeCredential';

function deterministicFill(seed = 0): SecureRandomFill {
  let cursor = seed;
  return (bytes) => {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = cursor & 0xff;
      cursor += 1;
    }
  };
}

const PEPPER_A = 'pepper-a-0123456789-abcdefghijklmnopqrstuvwxyz';
const PEPPER_B = 'pepper-b-0123456789-abcdefghijklmnopqrstuvwxyz';

describe('node credential contract', () => {
  it('generates independent pseudonymous ids and 256-bit versioned credentials', () => {
    const random = deterministicFill();
    const nodeId = generatePseudonymousNodeId(random);
    const credential = generateNodeCredential(random);

    expect(nodeId).toMatch(/^node_[A-Za-z0-9_-]{16}$/);
    expect(credential).toMatch(/^k2n_v1_[A-Za-z0-9_-]{43}$/);
    expect(isValidNodeId(nodeId)).toBe(true);
    expect(isValidNodeCredential(credential)).toBe(true);
    expect(credential).not.toContain(nodeId.replace(/^node_/, ''));
  });

  it('derives a deterministic 32-byte HMAC without storing the raw token', async () => {
    const credential = generateNodeCredential(deterministicFill(20));
    const first = await computeNodeCredentialHmac(credential, PEPPER_A);
    const second = await computeNodeCredentialHmac(credential, PEPPER_A);
    const otherPepper = await computeNodeCredentialHmac(credential, PEPPER_B);

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(second).toBe(first);
    expect(otherPepper).not.toBe(first);
    expect(first).not.toContain(credential);
  });

  it('creates credential-only material for rotation without manufacturing a replacement node id', async () => {
    const material = await createNodeCredentialMaterial(PEPPER_A, {
      randomFill: deterministicFill(11),
      keyVersion: 4,
    });

    expect(material).not.toHaveProperty('nodeId');
    expect(isValidNodeCredential(material.credential)).toBe(true);
    expect(material.credentialHmac).toMatch(/^[a-f0-9]{64}$/);
    expect(material.keyVersion).toBe(4);
    expect(material.credentialHmac).toBe(
      await computeNodeCredentialHmac(material.credential, PEPPER_A),
    );
  });

  it('creates enrollment material ready for one-time token delivery and private HMAC persistence', async () => {
    const material = await createNodeEnrollmentMaterial(PEPPER_A, {
      randomFill: deterministicFill(7),
      keyVersion: 2,
    });

    expect(isValidNodeId(material.nodeId)).toBe(true);
    expect(isValidNodeCredential(material.credential)).toBe(true);
    expect(material.credentialHmac).toMatch(/^[a-f0-9]{64}$/);
    expect(material.keyVersion).toBe(2);
    expect(material.credentialHmac).toBe(
      await computeNodeCredentialHmac(material.credential, PEPPER_A),
    );
  });

  it('fails closed on weak pepper, malformed credentials and invalid key versions', async () => {
    const credential = generateNodeCredential(deterministicFill());
    await expect(computeNodeCredentialHmac(credential, 'too-short')).rejects.toThrow('at least 32 bytes');
    await expect(computeNodeCredentialHmac('k2n_v1_not-valid', PEPPER_A)).rejects.toThrow('Invalid');
    await expect(createNodeCredentialMaterial(PEPPER_A, { keyVersion: 0 })).rejects.toThrow('1..32767');
    await expect(createNodeEnrollmentMaterial(PEPPER_A, { keyVersion: 0 })).rejects.toThrow('1..32767');
  });

  it('never treats a human/session-like token as a node credential', () => {
    expect(isValidNodeCredential('ya29.google-access-token')).toBe(false);
    expect(isValidNodeCredential('sb_publishable_example')).toBe(false);
    expect(isValidNodeCredential('eyJhbGciOiJIUzI1NiJ9.jwt')).toBe(false);
  });
});
