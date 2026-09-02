import type { ActiveNodeCredential } from './nodeProvisioning';
import { createCommunityHttpSender } from './httpTransport';
import {
  enqueueCommunityUpload,
  flushCommunityOutbox,
  type CommunityOutboxItem,
  type CommunityOutboxStore,
  type DeliveryResult,
  type OutboxFlushOptions,
  type OutboxFlushResult,
} from './outbox';
import type {
  CommunityAggregateRecord,
  CommunityNodeRuntimeSummary,
  CommunityUploadEnvelope,
  ObservedSegmentRef,
} from './protocol';
import type { NodeQualityScore } from './quality';
import type { CommunitySequenceStore } from './sequenceStore';

export interface CommunityBatchDraft {
  softwareVersion: string;
  methodologyVersion: string;
  modelFingerprint: string;
  quality: NodeQualityScore;
  runtime: CommunityNodeRuntimeSummary;
  records: CommunityAggregateRecord[];
  segmentSource?: ObservedSegmentRef['source'];
  segmentSourceVersion?: string;
}

export interface CommunityEnqueueOptions {
  /** Local-only stable key used to make bucket→outbox publication crash-idempotent. */
  publicationKey?: string;
  /** Prevents a bucket observed by one node from being attributed after a reprovision race. */
  expectedNodeId?: string;
}

export interface CommunityDeliveryRuntimeOptions {
  endpoint: string;
  activeNode: () => Promise<ActiveNodeCredential | undefined>;
  outbox: CommunityOutboxStore;
  sequences: CommunitySequenceStore;
  fetchImpl?: typeof fetch;
  nowMs?: () => number;
}

export interface CommunityDeliveryFlushResult extends OutboxFlushResult {
  skipped?: 'node_inactive';
}

export interface CommunityDeliveryRuntime {
  enqueue(draft: CommunityBatchDraft, options?: CommunityEnqueueOptions): Promise<CommunityOutboxItem>;
  releasePublication(nodeId: string, publicationKey: string): Promise<void>;
  flush(options?: OutboxFlushOptions): Promise<CommunityDeliveryFlushResult>;
}

function validNow(nowMs: () => number): number {
  const value = nowMs();
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid Community delivery clock');
  return value;
}

function emptyFlush(skipped: CommunityDeliveryFlushResult['skipped']): CommunityDeliveryFlushResult {
  return {
    attempted: 0,
    delivered: 0,
    retryScheduled: 0,
    deadLettered: 0,
    ...(skipped === undefined ? {} : { skipped }),
  };
}

/**
 * Delivery v2 binds outgoing batches to the node identity that is active at
 * enqueue/flush time. Human authentication never participates in this path.
 * A paused/revoked/unconfigured node simply does not flush pending aggregates.
 */
export function createCommunityDeliveryRuntime(
  options: CommunityDeliveryRuntimeOptions,
): CommunityDeliveryRuntime {
  const nowMs = options.nowMs ?? Date.now;

  async function sendScoped(
    envelope: CommunityUploadEnvelope,
    idempotencyKey: string,
  ): Promise<DeliveryResult> {
    const active = await options.activeNode();
    if (!active || active.nodeId !== envelope.nodeId) {
      return { ok: false, retryable: true, error: 'node_inactive_or_identity_changed' };
    }
    const sender = createCommunityHttpSender({
      endpoint: options.endpoint,
      nodeCredential: () => active.credential,
      ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    });
    const result = await sender(envelope, idempotencyKey);
    // A credential can rotate between the local active-node read and backend
    // verification. Preserve the aggregate for a later retry instead of turning
    // that race into permanent data loss.
    if (!result.ok && (result.statusCode === 401 || result.statusCode === 403)) {
      return { ...result, retryable: true };
    }
    return result;
  }

  return {
    async enqueue(draft, enqueueOptions = {}): Promise<CommunityOutboxItem> {
      const active = await options.activeNode();
      if (!active) throw new Error('An active Konta2r node is required to enqueue Community data');
      if (enqueueOptions.expectedNodeId !== undefined && active.nodeId !== enqueueOptions.expectedNodeId) {
        throw new Error('Active Konta2r node changed before Community enqueue');
      }
      const generatedAtMs = validNow(nowMs);
      const sequence = enqueueOptions.publicationKey === undefined
        ? await options.sequences.next(active.nodeId)
        : await options.sequences.reserve(active.nodeId, enqueueOptions.publicationKey);
      const observedSegment: ObservedSegmentRef = {
        segmentId: active.segmentId,
        source: draft.segmentSource ?? 'konta2r',
        ...(draft.segmentSourceVersion === undefined ? {} : { sourceVersion: draft.segmentSourceVersion }),
      };
      const envelope: CommunityUploadEnvelope = {
        schemaVersion: '2.0',
        nodeId: active.nodeId,
        sequence,
        generatedAtIso: new Date(generatedAtMs).toISOString(),
        observedSegment,
        softwareVersion: draft.softwareVersion,
        methodologyVersion: draft.methodologyVersion,
        modelFingerprint: draft.modelFingerprint,
        quality: draft.quality,
        runtime: draft.runtime,
        records: draft.records,
      };
      return enqueueCommunityUpload(options.outbox, envelope, generatedAtMs);
    },

    async releasePublication(nodeId, publicationKey): Promise<void> {
      await options.sequences.release(nodeId, publicationKey);
    },

    async flush(flushOptions = {}): Promise<CommunityDeliveryFlushResult> {
      const active = await options.activeNode();
      if (!active) return emptyFlush('node_inactive');
      return flushCommunityOutbox(options.outbox, sendScoped, {
        ...flushOptions,
        nodeId: active.nodeId,
      });
    },
  };
}
