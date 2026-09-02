import { createSupabaseHumanAuth } from '../auth/supabaseBrowser';
import type { NodeRuntimeController } from '../node/runtimeController';
import type { EdgeMobilityPipeline } from '../pipeline/edgeMobilityPipeline';
import { createCommunityDeliveryRuntime } from './deliveryRuntime';
import { CommunityFlowBucketCollector } from './flowBucketCollector';
import { CommunityFlowBucketPublisher } from './flowBucketPublisher';
import { IndexedDbCommunityFlowBucketStore } from './flowBucketStore';
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

export interface BrowserCommunityFlowPublisherOptions {
  community: NodeCommunityRuntime;
  runtime: Pick<NodeRuntimeController, 'snapshot'>;
  pipeline: Pick<EdgeMobilityPipeline, 'getInitialization'>;
  countingGeometryId: string;
  softwareVersion: string;
  methodologyVersion: string;
  bucketMs?: number;
  minCount?: number;
  minEventConfidence?: number;
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

/**
 * Creates the durable aggregate-only bridge after a semantic detector pipeline
 * exists. Returning undefined is intentional for builds without Community
 * backend configuration; local counting can continue independently.
 */
export function createBrowserCommunityFlowPublisher(
  options: BrowserCommunityFlowPublisherOptions,
): CommunityFlowBucketPublisher | undefined {
  const delivery = options.community.delivery();
  if (!delivery) return undefined;

  const collector = new CommunityFlowBucketCollector(
    new IndexedDbCommunityFlowBucketStore(),
    {
      countingGeometryId: options.countingGeometryId,
      ...(options.bucketMs === undefined ? {} : { bucketMs: options.bucketMs }),
      ...(options.minCount === undefined ? {} : { minCount: options.minCount }),
      ...(options.minEventConfidence === undefined
        ? {}
        : { minEventConfidence: options.minEventConfidence }),
    },
  );

  return new CommunityFlowBucketPublisher({
    collector,
    delivery,
    activeNodeId: () => {
      const snapshot = options.community.snapshot();
      return snapshot.sensorReady && snapshot.identity?.status === 'active'
        ? snapshot.identity.nodeId
        : undefined;
    },
    runtimeSnapshot: () => options.runtime.snapshot(),
    detectorInitialization: () => options.pipeline.getInitialization(),
    softwareVersion: options.softwareVersion,
    methodologyVersion: options.methodologyVersion,
  });
}
