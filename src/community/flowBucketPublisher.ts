import type { DetectorInitialization } from '../detection/types';
import type { NodeRuntimeSnapshot } from '../node/runtimeController';
import type { EdgeMobilityPipelineFrame } from '../pipeline/edgeMobilityPipeline';
import type { CommunityDeliveryFlushResult, CommunityDeliveryRuntime } from './deliveryRuntime';
import type { CommunityFlowBucketCollector, ClosedCommunityFlowBucket } from './flowBucketCollector';
import {
  communityModelFingerprint,
  communityQualityFromFlowBucket,
  communityRuntimeSummary,
} from './runtimeTelemetry';

type FlowBucketCollectorPort = Pick<CommunityFlowBucketCollector, 'observe' | 'closed' | 'commit'>;

export interface CommunityFlowBucketPublisherOptions {
  collector: FlowBucketCollectorPort;
  delivery: CommunityDeliveryRuntime;
  /** Redacted identity only. Never return or capture a raw sensor credential here. */
  activeNodeId: () => string | undefined;
  runtimeSnapshot: () => NodeRuntimeSnapshot;
  detectorInitialization: () => DetectorInitialization | null;
  softwareVersion: string;
  methodologyVersion: string;
  publicationCheckIntervalMs?: number;
  nowMs?: () => number;
}

export interface CommunityFlowPublishResult {
  closedBuckets: number;
  enqueuedBuckets: number;
  suppressedBuckets: number;
  retainedBuckets: number;
  flush: CommunityDeliveryFlushResult;
  skipped?: 'node_inactive' | 'model_unavailable' | 'enqueue_unavailable';
}

function validEpoch(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid Community publisher clock');
  return value;
}

function emptyFlush(): CommunityDeliveryFlushResult {
  return {
    attempted: 0,
    delivered: 0,
    retryScheduled: 0,
    deadLettered: 0,
  };
}

function publicationKey(bucket: ClosedCommunityFlowBucket): string {
  return [
    'flow-v2',
    bucket.nodeId,
    bucket.streamId,
    bucket.bucketStartMs,
    bucket.bucketEndMs,
  ].join(':');
}

/**
 * Bridges event-level edge processing and the aggregate-only Community delivery
 * boundary. All work is serialized so an asynchronous onFrame callback cannot
 * race bucket publication against another observation.
 */
export class CommunityFlowBucketPublisher {
  private readonly collector: FlowBucketCollectorPort;
  private readonly delivery: CommunityDeliveryRuntime;
  private readonly activeNodeId: () => string | undefined;
  private readonly runtimeSnapshot: () => NodeRuntimeSnapshot;
  private readonly detectorInitialization: () => DetectorInitialization | null;
  private readonly softwareVersion: string;
  private readonly methodologyVersion: string;
  private readonly publicationCheckIntervalMs: number;
  private readonly nowMs: () => number;
  private lastPublicationCheckMs = 0;
  private tail: Promise<void> = Promise.resolve();

  constructor(options: CommunityFlowBucketPublisherOptions) {
    this.collector = options.collector;
    this.delivery = options.delivery;
    this.activeNodeId = options.activeNodeId;
    this.runtimeSnapshot = options.runtimeSnapshot;
    this.detectorInitialization = options.detectorInitialization;
    this.softwareVersion = options.softwareVersion.trim();
    this.methodologyVersion = options.methodologyVersion.trim();
    this.publicationCheckIntervalMs = Math.max(1_000, options.publicationCheckIntervalMs ?? 15_000);
    this.nowMs = options.nowMs ?? Date.now;
    if (!this.softwareVersion) throw new Error('Community softwareVersion is required');
    if (!this.methodologyVersion) throw new Error('Community methodologyVersion is required');
  }

  observeFrame(frame: EdgeMobilityPipelineFrame, observedAtEpochMs = this.nowMs()): Promise<void> {
    const observedAt = validEpoch(observedAtEpochMs);
    return this.serialize(async () => {
      const nodeId = this.activeNodeId();
      if (nodeId && frame.crossings.length > 0) {
        await this.collector.observe(nodeId, frame.crossings, observedAt);
      }
      if (observedAt - this.lastPublicationCheckMs >= this.publicationCheckIntervalMs) {
        this.lastPublicationCheckMs = observedAt;
        await this.publishClosedInternal(observedAt);
      }
    });
  }

  publishClosed(nowEpochMs = this.nowMs()): Promise<CommunityFlowPublishResult> {
    const now = validEpoch(nowEpochMs);
    return this.serialize(() => this.publishClosedInternal(now));
  }

  /** Call on browser `online` to retry both unpublished closed buckets and the outbox. */
  connectivityRestored(nowEpochMs = this.nowMs()): Promise<CommunityFlowPublishResult> {
    return this.publishClosed(nowEpochMs);
  }

  private async publishClosedInternal(now: number): Promise<CommunityFlowPublishResult> {
    const nodeId = this.activeNodeId();
    if (!nodeId) {
      let flush = emptyFlush();
      try {
        flush = await this.delivery.flush({ nowMs: now });
      } catch {
        // No active node means no bucket can be attributed or sent. Durable state remains untouched.
      }
      return {
        closedBuckets: 0,
        enqueuedBuckets: 0,
        suppressedBuckets: 0,
        retainedBuckets: 0,
        flush,
        skipped: 'node_inactive',
      };
    }

    const buckets = await this.collector.closed(nodeId, now);
    let enqueuedBuckets = 0;
    let suppressedBuckets = 0;
    let retainedBuckets = 0;
    let skipped: CommunityFlowPublishResult['skipped'];

    for (const bucket of buckets) {
      // Defense in depth for custom/legacy collectors: never publish a bucket
      // that claims a different node than the redacted identity selected above.
      if (bucket.nodeId !== nodeId) {
        retainedBuckets += 1;
        skipped = 'enqueue_unavailable';
        continue;
      }
      if (bucket.records.length === 0) {
        await this.collector.commit(nodeId, bucket.bucketStartMs);
        suppressedBuckets += 1;
        continue;
      }

      const detector = this.detectorInitialization();
      if (!detector) {
        retainedBuckets += 1;
        skipped = 'model_unavailable';
        continue;
      }

      const snapshot = this.runtimeSnapshot();
      const key = publicationKey(bucket);
      try {
        const item = await this.delivery.enqueue({
          softwareVersion: this.softwareVersion,
          methodologyVersion: this.methodologyVersion,
          modelFingerprint: communityModelFingerprint(detector),
          quality: communityQualityFromFlowBucket(bucket, snapshot),
          runtime: communityRuntimeSummary(snapshot, detector),
          records: bucket.records,
        }, {
          publicationKey: key,
          expectedNodeId: bucket.nodeId,
        });
        if (item.nodeId !== bucket.nodeId) {
          throw new Error('Community outbox node does not match source bucket node');
        }
        // Deleting the source bucket only after durable outbox enqueue gives
        // at-least-once local publication. The reservation key makes a crash
        // between these two operations idempotent on retry.
        await this.collector.commit(nodeId, bucket.bucketStartMs);
        enqueuedBuckets += 1;
        // Once the source bucket is gone it can no longer be republished, so its
        // temporary reservation can be retired. Failure here is only local
        // housekeeping; the monotonic sequence and durable outbox stay valid.
        try {
          await this.delivery.releasePublication(item.nodeId, key);
        } catch {
          // A stale reservation is harmless and can be cleaned by later maintenance.
        }
      } catch {
        retainedBuckets += 1;
        skipped = 'enqueue_unavailable';
        break;
      }
    }

    let flush = emptyFlush();
    try {
      flush = await this.delivery.flush({ nowMs: now });
    } catch {
      // The outbox remains durable. A connectivity callback or later bucket
      // check will retry without losing the already-enqueued aggregate.
    }

    return {
      closedBuckets: buckets.length,
      enqueuedBuckets,
      suppressedBuckets,
      retainedBuckets,
      flush,
      ...(skipped === undefined ? {} : { skipped }),
    };
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.tail.then(operation, operation);
    this.tail = task.then(() => undefined, () => undefined);
    return task;
  }
}
