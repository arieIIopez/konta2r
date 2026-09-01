import type { CrossingDirection, LineCrossingEvent } from '../core/types';
import type { CommunityDirection, PublicFlowAggregate } from './protocol';
import type {
  CommunityFlowBucketDelta,
  CommunityFlowBucketStore,
} from './flowBucketStore';

export interface CommunityFlowBucketCollectorOptions {
  /** One local counting line feeds one public Community stream/segment. */
  countingGeometryId: string;
  bucketMs?: number;
  minCount?: number;
  minEventConfidence?: number;
  directionMap?: Partial<Record<CrossingDirection, CommunityDirection>>;
}

export interface ClosedCommunityFlowBucket {
  streamId: string;
  bucketStartMs: number;
  bucketEndMs: number;
  records: PublicFlowAggregate[];
  suppressedCount: number;
}

const DEFAULT_DIRECTION_MAP: Record<CrossingDirection, CommunityDirection> = {
  LEFT_TO_RIGHT: 'A_TO_B',
  RIGHT_TO_LEFT: 'B_TO_A',
};

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function validateEpochMs(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('Community bucket observation clock must be a non-negative integer epoch');
  }
  return value;
}

/**
 * Privacy-first rolling flow collector. It never persists event records. Each
 * observed frame is reduced immediately to count + confidence sum and exact
 * event timestamps are replaced by the coarse wall-clock bucket of observation.
 */
export class CommunityFlowBucketCollector {
  readonly bucketMs: number;
  readonly minCount: number;
  readonly streamId: string;
  private readonly store: CommunityFlowBucketStore;
  private readonly minEventConfidence: number;
  private readonly directionMap: Record<CrossingDirection, CommunityDirection>;

  constructor(store: CommunityFlowBucketStore, options: CommunityFlowBucketCollectorOptions) {
    const streamId = options.countingGeometryId.trim();
    if (!streamId) throw new Error('Community counting geometry is required');
    this.streamId = streamId;
    this.store = store;
    this.bucketMs = options.bucketMs ?? 5 * 60_000;
    this.minCount = Math.max(1, Math.floor(options.minCount ?? 3));
    this.minEventConfidence = clamp01(options.minEventConfidence ?? 0.5);
    this.directionMap = { ...DEFAULT_DIRECTION_MAP, ...options.directionMap };
    if (this.bucketMs < 60_000 || !Number.isSafeInteger(this.bucketMs)) {
      throw new Error('Community flow bucket must be an integer of at least 60 seconds');
    }
  }

  async observe(
    crossings: readonly LineCrossingEvent[],
    observedAtEpochMs: number,
  ): Promise<void> {
    const observedAt = validateEpochMs(observedAtEpochMs);
    const bucketStartMs = Math.floor(observedAt / this.bucketMs) * this.bucketMs;
    const bucketEndMs = bucketStartMs + this.bucketMs;
    const deltas = new Map<string, CommunityFlowBucketDelta>();

    for (const event of crossings) {
      if (event.geometryId !== this.streamId || event.confidence < this.minEventConfidence) continue;
      const direction = this.directionMap[event.direction] ?? 'UNSPECIFIED';
      const key = `${event.entityType}|${direction}`;
      const existing = deltas.get(key);
      if (existing) {
        existing.count += 1;
        existing.qualitySum += clamp01(event.confidence);
      } else {
        deltas.set(key, {
          streamId: this.streamId,
          bucketStartMs,
          bucketEndMs,
          entityType: event.entityType,
          direction,
          count: 1,
          qualitySum: clamp01(event.confidence),
        });
      }
    }

    for (const delta of deltas.values()) await this.store.add(delta);
  }

  async closed(nowEpochMs: number): Promise<ClosedCommunityFlowBucket[]> {
    const now = validateEpochMs(nowEpochMs);
    const starts = await this.store.listClosedBucketStarts(this.streamId, now);
    const result: ClosedCommunityFlowBucket[] = [];

    for (const bucketStartMs of starts) {
      const cells = await this.store.listBucket(this.streamId, bucketStartMs);
      if (cells.length === 0) continue;
      const bucketEndMs = cells[0]?.bucketEndMs ?? bucketStartMs + this.bucketMs;
      let suppressedCount = 0;
      const records: PublicFlowAggregate[] = [];
      for (const cell of cells) {
        if (cell.count < this.minCount) {
          suppressedCount += cell.count;
          continue;
        }
        records.push({
          schemaVersion: '2.0',
          aggregateType: 'flow',
          bucketStartMs: cell.bucketStartMs,
          bucketEndMs: cell.bucketEndMs,
          entityType: cell.entityType,
          direction: cell.direction,
          count: cell.count,
          meanQuality: cell.count === 0 ? 0 : clamp01(cell.qualitySum / cell.count),
        });
      }
      records.sort((a, b) => (
        a.entityType.localeCompare(b.entityType)
        || a.direction.localeCompare(b.direction)
      ));
      result.push({
        streamId: this.streamId,
        bucketStartMs,
        bucketEndMs,
        records,
        suppressedCount,
      });
    }
    return result;
  }

  /** Commit only after enqueue succeeded, or when an empty low-count bucket was deliberately suppressed. */
  async commit(bucketStartMs: number): Promise<void> {
    await this.store.deleteBucket(this.streamId, bucketStartMs);
  }
}
