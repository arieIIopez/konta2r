import type { EdgeMobilityPipelineFrame } from '../pipeline/edgeMobilityPipeline';
import type { CommunityFlowPublishResult } from './flowBucketPublisher';

export interface CommunityFlowPublisherPort {
  observeFrame(frame: EdgeMobilityPipelineFrame, observedAtEpochMs?: number): Promise<void>;
  publishClosed(nowEpochMs?: number): Promise<CommunityFlowPublishResult>;
  connectivityRestored(nowEpochMs?: number): Promise<CommunityFlowPublishResult>;
}

export interface CommunityPendingFlowStreamStore {
  listStreams(nodeId: string): Promise<string[]>;
}

export interface CommunityFlowRuntimeOptions {
  /** Redacted active node id only. Never expose the sensor credential here. */
  activeNodeId: () => string | undefined;
  publisherFactory: (streamId: string) => CommunityFlowPublisherPort | undefined;
  pendingStreams: CommunityPendingFlowStreamStore;
  maintenanceIntervalMs?: number;
  nowMs?: () => number;
}

export interface CommunityFlowRuntimeSnapshot {
  nodeId?: string;
  activeStreamId?: string;
  trackedStreamIds: string[];
  pendingRecovered: number;
}

export interface CommunityFlowRuntime {
  setActiveStream(streamId: string | undefined): Promise<void>;
  observeFrame(frame: EdgeMobilityPipelineFrame, observedAtEpochMs?: number): Promise<void>;
  publishClosed(nowEpochMs?: number): Promise<void>;
  connectivityRestored(nowEpochMs?: number): Promise<void>;
  snapshot(): CommunityFlowRuntimeSnapshot;
  destroy(): void;
}

function validEpoch(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid Community flow runtime clock');
  return value;
}

function normalizedStreamId(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

/**
 * Owns the dynamic set of Community flow publishers required by versioned
 * counting geometry. Only the currently active stream may ingest new events.
 * Retired streams remain alive only while durable bucket state exists so an
 * open bucket can close naturally and be published/suppressed after a geometry
 * revision, browser reload or temporary loss of connectivity.
 */
export class BrowserCommunityFlowRuntime implements CommunityFlowRuntime {
  private readonly activeNodeId: () => string | undefined;
  private readonly publisherFactory: (streamId: string) => CommunityFlowPublisherPort | undefined;
  private readonly pendingStreams: CommunityPendingFlowStreamStore;
  private readonly maintenanceIntervalMs: number;
  private readonly nowMs: () => number;
  private readonly publishers = new Map<string, CommunityFlowPublisherPort>();
  private activeStreamId: string | undefined;
  private currentNodeId: string | undefined;
  private pendingRecovered = 0;
  private lastMaintenanceMs = 0;
  private tail: Promise<void> = Promise.resolve();
  private destroyed = false;

  constructor(options: CommunityFlowRuntimeOptions) {
    this.activeNodeId = options.activeNodeId;
    this.publisherFactory = options.publisherFactory;
    this.pendingStreams = options.pendingStreams;
    this.maintenanceIntervalMs = Math.max(1_000, Math.floor(options.maintenanceIntervalMs ?? 15_000));
    this.nowMs = options.nowMs ?? Date.now;
  }

  setActiveStream(streamId: string | undefined): Promise<void> {
    const normalized = normalizedStreamId(streamId);
    return this.serialize(async () => {
      this.activeStreamId = normalized;
      await this.recoverCurrentNodeStreams();
    });
  }

  observeFrame(frame: EdgeMobilityPipelineFrame, observedAtEpochMs = this.nowMs()): Promise<void> {
    const observedAt = validEpoch(observedAtEpochMs);
    return this.serialize(async () => {
      await this.recoverCurrentNodeStreams();
      if (!this.currentNodeId) return;

      const active = this.activeStreamId === undefined
        ? undefined
        : this.ensurePublisher(this.activeStreamId);
      if (active) await active.observeFrame(frame, observedAt);

      if (observedAt - this.lastMaintenanceMs >= this.maintenanceIntervalMs) {
        this.lastMaintenanceMs = observedAt;
        await this.publishRetiredStreams(observedAt);
        await this.recoverCurrentNodeStreams();
      }
    });
  }

  publishClosed(nowEpochMs = this.nowMs()): Promise<void> {
    const now = validEpoch(nowEpochMs);
    return this.serialize(async () => {
      await this.recoverCurrentNodeStreams();
      if (!this.currentNodeId) return;
      for (const publisher of this.publishers.values()) {
        await publisher.publishClosed(now);
      }
      await this.recoverCurrentNodeStreams();
    });
  }

  connectivityRestored(nowEpochMs = this.nowMs()): Promise<void> {
    const now = validEpoch(nowEpochMs);
    return this.serialize(async () => {
      await this.recoverCurrentNodeStreams();
      if (!this.currentNodeId) return;
      for (const publisher of this.publishers.values()) {
        await publisher.connectivityRestored(now);
      }
      await this.recoverCurrentNodeStreams();
    });
  }

  snapshot(): CommunityFlowRuntimeSnapshot {
    return {
      ...(this.currentNodeId === undefined ? {} : { nodeId: this.currentNodeId }),
      ...(this.activeStreamId === undefined ? {} : { activeStreamId: this.activeStreamId }),
      trackedStreamIds: [...this.publishers.keys()].sort(),
      pendingRecovered: this.pendingRecovered,
    };
  }

  destroy(): void {
    this.destroyed = true;
    this.publishers.clear();
    this.currentNodeId = undefined;
    this.activeStreamId = undefined;
  }

  private ensurePublisher(streamId: string): CommunityFlowPublisherPort | undefined {
    const existing = this.publishers.get(streamId);
    if (existing) return existing;
    const publisher = this.publisherFactory(streamId);
    if (!publisher) return undefined;
    this.publishers.set(streamId, publisher);
    return publisher;
  }

  private async recoverCurrentNodeStreams(): Promise<void> {
    const nodeId = this.activeNodeId();
    if (nodeId !== this.currentNodeId) {
      this.currentNodeId = nodeId;
      this.publishers.clear();
      this.pendingRecovered = 0;
      this.lastMaintenanceMs = 0;
    }
    if (!nodeId) return;

    const pending = new Set(await this.pendingStreams.listStreams(nodeId));
    if (this.activeStreamId) this.ensurePublisher(this.activeStreamId);
    for (const streamId of pending) {
      if (!this.publishers.has(streamId) && this.ensurePublisher(streamId)) {
        this.pendingRecovered += 1;
      }
    }

    // Once a retired stream has no durable source bucket left, its publisher is
    // unnecessary. The active stream stays resident even when its bucket is empty.
    for (const streamId of [...this.publishers.keys()]) {
      if (streamId !== this.activeStreamId && !pending.has(streamId)) {
        this.publishers.delete(streamId);
      }
    }
  }

  private async publishRetiredStreams(now: number): Promise<void> {
    for (const [streamId, publisher] of this.publishers) {
      if (streamId === this.activeStreamId) continue;
      await publisher.publishClosed(now);
    }
  }

  private serialize(operation: () => Promise<void>): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    const task = this.tail.then(operation, operation);
    this.tail = task.then(() => undefined, () => undefined);
    return task;
  }
}
