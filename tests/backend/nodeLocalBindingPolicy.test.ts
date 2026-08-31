import { describe, expect, it } from 'vitest';
import bindingContract from '../../src/backend/nodeLocalBinding.ts?raw';
import bindingStore from '../../src/backend/indexedDbNodeLocalBinding.ts?raw';
import vaultStore from '../../src/backend/indexedDbNodeCredentialVault.ts?raw';
import outboxStore from '../../src/community/indexedDbOutbox.ts?raw';

describe('local node binding persistence policy', () => {
  it('keeps config, secrets and aggregate queue in distinct IndexedDB databases', () => {
    expect(bindingStore).toContain("const DB_NAME = 'Konta2rNodeConfigDB'");
    expect(vaultStore).toContain("const DB_NAME = 'Konta2rNodeSecretsDB'");
    expect(outboxStore).toContain("const DB_NAME = 'Konta2rCommunityDB'");
  });

  it('does not include raw credential fields in LocalNodeBinding', () => {
    const block = bindingContract.match(/export interface LocalNodeBinding \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(block).toContain('nodeId: string');
    expect(block).toContain('segmentId: string');
    expect(block).toContain('credentialVersion?: number');
    expect(block).not.toMatch(/\bcredential\s*:/);
    expect(block).not.toMatch(/token|authorization/i);
  });

  it('does not use localStorage as an identity or secret store', () => {
    expect(`${bindingStore}\n${bindingContract}`).not.toMatch(/localStorage|sessionStorage/);
  });

  it('states explicitly that cached local status is not authorization authority', () => {
    expect(bindingContract).toMatch(/Backend node state remains authoritative/i);
    expect(bindingContract).toMatch(/never establishes server\s+authorization/i);
  });
});
