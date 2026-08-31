import { isValidNodeId } from '../backend/nodeCredential.ts';
import {
  createVaultBackedNodeCredentialProvider,
  type NodeCredentialVault,
} from '../backend/nodeCredentialVault.ts';
import { createCommunityHttpSender } from './httpTransport.ts';
import {
  enqueueCommunityUpload,
  flushCommunityOutbox,
  type CommunityOutboxItem,
  type CommunityOutboxStore,
  type OutboxFlushOptions,
  type OutboxFlushResult,
} from './outbox.ts';
import type { CommunityUploadEnvelope } from './protocol.ts';

export interface CommunityDeliveryRuntimeOptions {
  nodeId: string;
  endpoint: string;
  vault: NodeCredentialVault;
  outbox: CommunityOutboxStore;
  fetchImpl?: typeof fetch;
}

export interface CommunityDeliverySnapshot {
  nodeId: string;
  credentialAvailable: boolean;
  pending: number;
  deadLetter: number;
}

export interface CommunityDeliveryRuntime {
  enqueue(envelope: CommunityUploadEnvelope, nowMs?: number): Promise<CommunityOutboxItem>;
  flush(options?: OutboxFlushOptions): Promise<OutboxFlushResult>;
  snapshot(): Promise<CommunityDeliverySnapshot>;
}

/**
 * Binds one local Community queue to exactly one pseudonymous node identity.
 * The outbox never receives credential material: the HTTP sender resolves it
 * from the vault immediately before each request.
 */
export function createCommunityDeliveryRuntime(
  options: CommunityDeliveryRuntimeOptions,
): CommunityDeliveryRuntime {
  if (!isValidNodeId(options.nodeId)) throw new Error('Invalid Konta2r node id');

  const provider = createVaultBackedNodeCredentialProvider(options.vault, options.nodeId);
  const sender = createCommunityHttpSender({
    endpoint: options.endpoint,
    nodeCredential: provider,
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
  });

  return {
    async enqueue(envelope, nowMs): Promise<CommunityOutboxItem> {
      if (envelope.nodeId !== options.nodeId) {
        throw new Error('Community envelope node identity does not match configured node');
      }
      return await enqueueCommunityUpload(options.outbox, envelope, nowMs);
    },

    async flush(flushOptions = {}): Promise<OutboxFlushResult> {
      return await flushCommunityOutbox(options.outbox, sender, flushOptions);
    },

    async snapshot(): Promise<CommunityDeliverySnapshot> {
      const [credentialAvailable, pending, deadLetter] = await Promise.all([
        options.vault.has(options.nodeId),
        options.outbox.count('pending'),
        options.outbox.count('dead_letter'),
      ]);
      return {
        nodeId: options.nodeId,
        credentialAvailable,
        pending,
        deadLetter,
      };
    },
  };
}
