import { describe, expect, it } from 'vitest';
import { communityIngestEndpoint } from '../../src/community/browserDeliveryRuntime';
import browserRuntimeSource from '../../src/community/browserDeliveryRuntime.ts?raw';
import vaultSource from '../../src/backend/indexedDbNodeCredentialVault.ts?raw';
import outboxSource from '../../src/community/indexedDbOutbox.ts?raw';

describe('browser Community delivery wiring', () => {
  it('derives ingest-community from the configured Supabase project URL', () => {
    expect(communityIngestEndpoint({
      url: 'https://project-ref.supabase.co',
      publishableKey: 'sb_publishable_abcdefghijklmnopqrstuvwxyz',
    })).toBe('https://project-ref.supabase.co/functions/v1/ingest-community');
  });

  it('keeps encrypted credentials and aggregate outbox in separate IndexedDB databases', () => {
    expect(vaultSource).toContain("const DB_NAME = 'Konta2rNodeSecretsDB'");
    expect(outboxSource).toContain("const DB_NAME = 'Konta2rCommunityDB'");
    expect(browserRuntimeSource).toContain('new IndexedDbNodeCredentialVault');
    expect(browserRuntimeSource).toContain('new IndexedDbCommunityOutboxStore');
  });

  it('does not pass credential material into the outbox constructor', () => {
    expect(browserRuntimeSource).not.toMatch(/OutboxStore\([^)]*credential/i);
    expect(browserRuntimeSource).toContain('vault,');
    expect(browserRuntimeSource).toContain('outbox,');
  });
});
