import { IndexedDbNodeCredentialVault } from '../backend/indexedDbNodeCredentialVault.ts';
import { IndexedDbNodeLocalBindingStore } from '../backend/indexedDbNodeLocalBinding.ts';
import { IndexedDbCommunityOutboxStore } from '../community/indexedDbOutbox.ts';
import {
  createNodeOperationalStatusSource,
  type NodeOperationalStatusSource,
} from './operationalStatus.ts';

export interface BrowserNodeOperationalStatusOptions {
  bindingDatabaseName?: string;
  vaultDatabaseName?: string;
  outboxDatabaseName?: string;
}

/**
 * Read-only composition used by NodePanel. It can inspect whether credential
 * material is available but never receives or returns the raw credential.
 */
export function createBrowserNodeOperationalStatusSource(
  options: BrowserNodeOperationalStatusOptions = {},
): NodeOperationalStatusSource {
  return createNodeOperationalStatusSource({
    bindingStore: new IndexedDbNodeLocalBindingStore(options.bindingDatabaseName),
    vault: new IndexedDbNodeCredentialVault(options.vaultDatabaseName),
    outbox: new IndexedDbCommunityOutboxStore(options.outboxDatabaseName),
  });
}
