import { IndexedDbNodeCredentialVault } from '../backend/indexedDbNodeCredentialVault.ts';
import type { SupabaseBrowserConfig } from '../backend/supabaseConfig.ts';
import { IndexedDbCommunityOutboxStore } from './indexedDbOutbox.ts';
import {
  createCommunityDeliveryRuntime,
  type CommunityDeliveryRuntime,
} from './deliveryRuntime.ts';

export interface BrowserCommunityDeliveryRuntimeOptions {
  config: SupabaseBrowserConfig;
  nodeId: string;
  fetchImpl?: typeof fetch;
  vaultDatabaseName?: string;
  outboxDatabaseName?: string;
}

export function communityIngestEndpoint(config: SupabaseBrowserConfig): string {
  return `${config.url}/functions/v1/ingest-community`;
}

/**
 * Standard browser wiring: secrets and aggregate queue intentionally use
 * separate IndexedDB databases so queue inspection/export never includes auth.
 */
export function createBrowserCommunityDeliveryRuntime(
  options: BrowserCommunityDeliveryRuntimeOptions,
): CommunityDeliveryRuntime {
  const vault = new IndexedDbNodeCredentialVault(options.vaultDatabaseName);
  const outbox = new IndexedDbCommunityOutboxStore(options.outboxDatabaseName);
  return createCommunityDeliveryRuntime({
    nodeId: options.nodeId,
    endpoint: communityIngestEndpoint(options.config),
    vault,
    outbox,
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
  });
}
