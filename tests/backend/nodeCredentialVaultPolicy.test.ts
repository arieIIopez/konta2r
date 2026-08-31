import { describe, expect, it } from 'vitest';
import vaultCrypto from '../../src/backend/nodeCredentialVault.ts?raw';
import indexedDbVault from '../../src/backend/indexedDbNodeCredentialVault.ts?raw';
import nodeControl from '../../src/backend/nodeControlClient.ts?raw';
import outbox from '../../src/community/outbox.ts?raw';

const combinedPersistence = `${indexedDbVault}\n${outbox}`;

describe('node credential local persistence policy', () => {
  it('never uses localStorage/sessionStorage for sensor credentials', () => {
    expect(combinedPersistence).not.toMatch(/localStorage|sessionStorage/);
    expect(indexedDbVault).toContain("createObjectStore('keys')");
    expect(indexedDbVault).toContain("createObjectStore('credentials'");
  });

  it('stores encrypted records rather than raw credential fields in IndexedDB', () => {
    expect(indexedDbVault).toContain('encryptNodeCredentialSecret(secret, key)');
    expect(indexedDbVault).toContain("db.put('credentials', record)");
    expect(indexedDbVault).not.toMatch(/db\.put\('credentials',\s*secret/);
    expect(vaultCrypto).toContain('ciphertext:');
    expect(vaultCrypto).toContain("name: 'AES-GCM'");
  });

  it('keeps credentials out of Community outbox items', () => {
    const interfaceBlock = outbox.match(/export interface CommunityOutboxItem \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(interfaceBlock).not.toMatch(/credential|authorization|token/i);
  });

  it('does not return raw credentials from the browser node-control API', () => {
    const resultInterface = nodeControl.match(/export interface NodeControlNodeResult \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(resultInterface).not.toMatch(/\bcredential\s*:/);
    expect(resultInterface).toContain('credentialStored: boolean');
    expect(nodeControl).toContain('await options.vault.put');
    expect(nodeControl).toContain('await options.vault.delete');
  });

  it('documents the same-origin script limitation instead of claiming XSS protection', () => {
    expect(indexedDbVault).toMatch(/not against arbitrary JavaScript/i);
    expect(vaultCrypto).not.toMatch(/XSS[- ]proof|XSS[- ]safe|unbreakable|impossible to steal/i);
  });
});
