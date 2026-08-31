import type { CrossingDirection, LineCrossingEvent } from '../core/types';
import type { CommunityDirection, PublicFlowAggregate } from './protocol';

export interface CommunityFlowAggregationOptions {
  bucketMs?: number;
  minCount?: number;
  minEventConfidence?: number;
  /** Allows a deployment to define the semantic mapping of local line sides. */
  directionMap?: Partial<Record<CrossingDirection, CommunityDirection>>;
}

export interface CommunityFlowAggregate extends PublicFlowAggregate {
  geometryId: string;
}

interface MutableFlowAggregate {
  bucketStartMs: number;
  geometryId: string;
  entityType: LineCrossingEvent['entityType'];
  direction: CommunityDirection;
  count: number;
  qualitySum: number;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

const DEFAULT_DIRECTION_MAP: Record<CrossingDirection, CommunityDirection> = {
  LEFT_TO_RIGHT: 'A_TO_B',
  RIGHT_TO_LEFT: 'B_TO_A',
};

/**
 * Reduces local event-level crossings to community-safe time buckets. Event
 * IDs, track IDs and exact timestamps are consumed locally and never appear in
 * the returned aggregates.
 */
export function aggregateCrossingsForCommunity(
  events: readonly LineCrossingEvent[],
  options: CommunityFlowAggregationOptions = {},
): CommunityFlowAggregate[] {
  const bucketMs = options.bucketMs ?? 5 * 60_000;
  const minCount = Math.max(1, Math.floor(options.minCount ?? 3));
  const minEventConfidence = clamp01(options.minEventConfidence ?? 0.5);
  const directionMap = { ...DEFAULT_DIRECTION_MAP, ...options.directionMap };

  if (bucketMs < 60_000) {
    throw new Error('Community flow aggregation bucket must be at least 60 seconds');
  }

  const groups = new Map<string, MutableFlowAggregate>();

  for (const event of events) {
    if (!Number.isFinite(event.timestampMs) || event.confidence < minEventConfidence) continue;
    const direction = directionMap[event.direction] ?? 'UNSPECIFIED';
    const bucketStartMs = Math.floor(event.timestampMs / bucketMs) * bucketMs;
    const key = [
      bucketStartMs,
      event.geometryId,
      event.entityType,
      direction,
    ].join('|');

    let group = groups.get(key);
    if (!group) {
      group = {
        bucketStartMs,
        geometryId: event.geometryId,
        entityType: event.entityType,
        direction,
        count: 0,
        qualitySum: 0,
      };
      groups.set(key, group);
    }

    group.count += 1;
    group.qualitySum += clamp01(event.confidence);
  }

  return [...groups.values()]
    .filter((group) => group.count >= minCount)
    .map((group): CommunityFlowAggregate => ({
      schemaVersion: '2.0',
      aggregateType: 'flow',
      bucketStartMs: group.bucketStartMs,
      bucketEndMs: group.bucketStartMs + bucketMs,
      geometryId: group.geometryId,
      entityType: group.entityType,
      direction: group.direction,
      count: group.count,
      meanQuality: group.count === 0 ? 0 : group.qualitySum / group.count,
    }))
    .sort((a, b) => (
      a.bucketStartMs - b.bucketStartMs
      || a.geometryId.localeCompare(b.geometryId)
      || a.entityType.localeCompare(b.entityType)
      || a.direction.localeCompare(b.direction)
    ));
}
