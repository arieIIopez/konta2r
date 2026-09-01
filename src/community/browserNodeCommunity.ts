import { createSupabaseHumanAuth } from '../auth/supabaseBrowser';
import { createCommunityDeliveryRuntime } from './deliveryRuntime';
import { createCommunityHttpSender } from './httpTransport';
import { IndexedDbNodeIdentityStore } from './indexedDbNodeIdentity';
import { IndexedDbCommunityOutboxStore } from './indexedDbOutbox';
import { createNodeAdminClient } from './nodeAdminClient';
import { createNodeCommunityController, type NodeCommunityRuntime } from './nodeCommunityController';
import { createNodeProvisioner } from './nodeProvisioning';
import { IndexedDbCommunitySequenceStore } from './sequenceStore';

export interface BrowserNodeCommunityOptions {
  projectUrl?: string;
  publishableKey?: string;
  appOrigin: string;
}

function usable(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  if (/YOUR_PROJECT_REF|REPLACE_ME/i.test(normalized)) return undefined;
  return normalized;
}

export function createBrowserNodeCommunity(options: BrowserNodeCommunityOptions): NodeCommunityRuntime {
  const projectUrl = usable(options.projectUrl);
  const publishableKey = usable(options.publishableKey);
  if (!projectUrl || !publishableKey) {
    return createNodeCommunityController({ configured: false });
  }

  const auth = createSupabaseHumanAuth({
    projectUrl,
    publishableKey,
    appOrigin: options.appOrigin,
  });
  const admin = createNodeAdminClient({
    projectUrl,
    publishableKey,
    accessToken: () => auth.accessToken(),
  });
  const provisioner = createNodeProvisioner({
    admin,
    store: new IndexedDbNodeIdentityStore(),
  });
  const ingestEndpoint = new URL('/functions/v1/ingest-community', projectUrl).toString();
  const sender = createCommunityHttpSender({
    endpoint: ingestEndpoint,
    nodeCredential: async () => (await provisioner.activeCredential())?.credential,
  });
  const delivery = createCommunityDeliveryRuntime({
    endpoint: ingestEndpoint,
    activeNode: () => provisioner.activeCredential(),
    outbox: new IndexedDbCommunityOutboxStore(),
    sequences: new IndexedDbCommunitySequenceStore(),
  });

  return createNodeCommunityController({
    configured: true,
    auth,
    provisioner,
    sender,
    delivery,
  });
}
