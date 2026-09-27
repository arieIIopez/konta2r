import type { EntityType } from '../core/types.ts';
import type { SpatialTrackSample } from './types.ts';

export interface PublicAggregationOptions {
  bucketMs?: number;
  cellSizeMeters?: number;
  minUniqueTracks?: number;
  minQuality?: number;
}

export interface PublicSpatialAggregate {
  schemaVersion: '2.0';
  bucketStartMs: number;
  bucketEndMs: number;
  cellX: number;
  cellY: number;
  cellSizeMeters: number;
  entityType: EntityType;
  uniqueEntities: number;
  sampleCount: number;
  meanSpeedMps?: number;
  meanQuality: number;
}

interface MutableAggregate {
  bucketStartMs: number;
  cellX: number;
  cellY: number;
  entityType: EntityType;
  trackIds: Set<string>;
  sampleCount: number;
  qualitySum: number;
  speedSum: number;
  speedCount: number;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Converts private per-track spatial samples into publication-safe cells.
 * Track IDs are used only transiently to deduplicate local contributors inside
 * a bucket and are never present in the returned public records.
 */
export function aggregateForPublicCommons(
  samples: readonly SpatialTrackSample[],
  options: PublicAggregationOptions = {},
): PublicSpatialAggregate[] {
  const bucketMs = options.bucketMs ?? 5 * 60 * 1000;
  const cellSizeMeters = options.cellSizeMeters ?? 5;
  const minUniqueTracks = Math.max(1, options.minUniqueTracks ?? 3);
  const minQuality = clamp01(options.minQuality ?? 0.55);

  if (!(bucketMs > 0)) {
    throw new Error('bucketMs must be greater than zero');
  }
  if (!(cellSizeMeters > 0)) {
    throw new Error('cellSizeMeters must be greater than zero');
  }

  const groups = new Map<string, MutableAggregate>();

  for (const sample of samples) {
    const quality = Math.min(
      clamp01(sample.confidence),
      clamp01(sample.calibrationQuality),
      clamp01(sample.motionQuality),
    );
    if (quality < minQuality) {
      continue;
    }

    const bucketStartMs = Math.floor(sample.timestampMs / bucketMs) * bucketMs;
    const cellX = Math.floor(sample.position.xMeters / cellSizeMeters);
    const cellY = Math.floor(sample.position.yMeters / cellSizeMeters);
    const key = `${bucketStartMs}|${cellX}|${cellY}|${sample.entityType}`;
    let group = groups.get(key);

    if (!group) {
      group = {
        bucketStartMs,
        cellX,
        cellY,
        entityType: sample.entityType,
        trackIds: new Set<string>(),
        sampleCount: 0,
        qualitySum: 0,
        speedSum: 0,
        speedCount: 0,
      };
      groups.set(key, group);
    }

    group.trackIds.add(sample.renderTrackId);
    group.sampleCount += 1;
    group.qualitySum += quality;

    if (sample.speedMps !== undefined && Number.isFinite(sample.speedMps) && sample.speedMps >= 0) {
      group.speedSum += sample.speedMps;
      group.speedCount += 1;
    }
  }

  return [...groups.values()]
    .filter((group) => group.trackIds.size >= minUniqueTracks)
    .map((group): PublicSpatialAggregate => ({
      schemaVersion: '2.0',
      bucketStartMs: group.bucketStartMs,
      bucketEndMs: group.bucketStartMs + bucketMs,
      cellX: group.cellX,
      cellY: group.cellY,
      cellSizeMeters,
      entityType: group.entityType,
      uniqueEntities: group.trackIds.size,
      sampleCount: group.sampleCount,
      ...(group.speedCount === 0 ? {} : { meanSpeedMps: group.speedSum / group.speedCount }),
      meanQuality: group.sampleCount === 0 ? 0 : group.qualitySum / group.sampleCount,
    }))
    .sort((a, b) => (
      a.bucketStartMs - b.bucketStartMs
      || a.cellX - b.cellX
      || a.cellY - b.cellY
      || a.entityType.localeCompare(b.entityType)
    ));
}
