import type { ActivityEpisode } from '../relations/types';
import type { PublicLifeAggregate } from './protocol';

export type PublicLifeActivityClass =
  | 'seated_use'
  | 'supported_stay'
  | 'social_interaction'
  | 'mobility_relation'
  | 'spatial_context'
  | 'other_observed_relation';

export type PublicLifeElementClass =
  | 'none'
  | 'seating'
  | 'edge_support'
  | 'greenery'
  | 'transit'
  | 'stairs'
  | 'frontage'
  | 'play'
  | 'cycle_parking'
  | 'other'
  | 'mixed';

export interface CommunityPublicLifeAggregationOptions {
  /** Converts episode-local timestamps to Unix epoch milliseconds. */
  timestampToEpochMs: (timestampMs: number) => number;
  /** Resolves an exact local semantic element id to its local type. */
  elementTypeForId?: (semanticElementId: string) => string | undefined;
  bucketMs?: number;
  minUniqueEntities?: number;
  minEpisodes?: number;
  durationQuantumSeconds?: number;
  minEpisodeConfidence?: number;
}

export interface CommunityPublicLifeAggregationResult {
  records: PublicLifeAggregate[];
  suppressedGroupCount: number;
  suppressedEpisodeContributions: number;
  ignoredOpenEpisodes: number;
  ignoredLowConfidenceEpisodes: number;
}

interface MutableAggregate {
  bucketStartMs: number;
  bucketEndMs: number;
  activityClass: PublicLifeActivityClass;
  elementClass: PublicLifeElementClass;
  episodeIds: Set<string>;
  entityIds: Set<string>;
  totalDurationSeconds: number;
  participantTimeSeconds: number;
  qualityWeightedSeconds: number;
  qualityWeightSeconds: number;
}

const ACTIVITY_BY_PREDICATE: Readonly<Record<string, PublicLifeActivityClass>> = {
  'sitting on': 'seated_use',
  'leaning against': 'supported_stay',
  'talking to': 'social_interaction',
  'walking with': 'social_interaction',
  'sitting with': 'social_interaction',
  riding: 'mobility_relation',
  holding: 'mobility_relation',
  carrying: 'mobility_relation',
  pushing: 'mobility_relation',
  'walking beside': 'mobility_relation',
  'standing beside': 'spatial_context',
  using: 'spatial_context',
  'looking at': 'spatial_context',
  'walking past': 'spatial_context',
  beside: 'spatial_context',
  'in front of': 'spatial_context',
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function privacyFloorInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 3) {
    throw new Error(`${label} must be an integer >= 3 for Community privacy`);
  }
  return value;
}

function finitePositive(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be finite and > 0`);
  }
  return value;
}

function normalizeElementType(type: string | undefined): PublicLifeElementClass {
  const value = type?.trim().toLowerCase().replaceAll('-', '_').replaceAll(' ', '_');
  if (!value) return 'other';
  if (['bench', 'seat', 'chair', 'seating'].includes(value)) return 'seating';
  if (
    ['wall', 'wall_edge', 'edge', 'ledge', 'murete', 'planter_edge', 'retaining_wall']
      .includes(value)
  ) return 'edge_support';
  if (['tree', 'greenery', 'vegetation', 'planter', 'canopy'].includes(value)) return 'greenery';
  if (['bus_stop', 'transit_stop', 'metro_entrance', 'station_entrance'].includes(value)) return 'transit';
  if (['stairs', 'stair', 'steps'].includes(value)) return 'stairs';
  if (['shopfront', 'storefront', 'frontage', 'facade', 'fachada'].includes(value)) return 'frontage';
  if (['play_area', 'playground', 'play_equipment'].includes(value)) return 'play';
  if (['cycle_parking', 'bike_rack', 'bicycle_parking'].includes(value)) return 'cycle_parking';
  return 'other';
}

function episodeElementClass(
  episode: ActivityEpisode,
  elementTypeForId: ((id: string) => string | undefined) | undefined,
): PublicLifeElementClass {
  if (episode.semanticElementIds.length === 0) return 'none';
  const classes = new Set(
    episode.semanticElementIds.map((id) =>
      normalizeElementType(elementTypeForId?.(id))),
  );
  if (classes.size === 0) return 'other';
  if (classes.size > 1) return 'mixed';
  return [...classes][0] ?? 'other';
}

export function publicLifeActivityClassForPredicate(
  predicate: string,
): PublicLifeActivityClass {
  return ACTIVITY_BY_PREDICATE[predicate.trim().toLowerCase()]
    ?? 'other_observed_relation';
}

function bucketKey(
  bucketStartMs: number,
  activityClass: PublicLifeActivityClass,
  elementClass: PublicLifeElementClass,
): string {
  return [bucketStartMs, activityClass, elementClass].join('|');
}

function roundDuration(valueSeconds: number, quantumSeconds: number): number {
  return Math.max(0, Math.round(valueSeconds / quantumSeconds) * quantumSeconds);
}

/**
 * Converts local relation episodes into Community-safe coarse aggregates.
 *
 * Exact track ids, episode ids and semantic element ids are consumed only
 * inside this function. They never appear in returned public records.
 */
export function aggregatePublicLifeForCommunity(
  episodes: readonly ActivityEpisode[],
  options: CommunityPublicLifeAggregationOptions,
): CommunityPublicLifeAggregationResult {
  const bucketMs = options.bucketMs ?? 5 * 60_000;
  const minUniqueEntities = privacyFloorInteger(
    options.minUniqueEntities ?? 3,
    'minUniqueEntities',
  );
  const minEpisodes = privacyFloorInteger(options.minEpisodes ?? 3, 'minEpisodes');
  const durationQuantumSeconds = finitePositive(
    options.durationQuantumSeconds ?? 10,
    'durationQuantumSeconds',
  );
  const minEpisodeConfidence = clamp01(options.minEpisodeConfidence ?? 0.5);

  if (!Number.isSafeInteger(bucketMs) || bucketMs < 60_000) {
    throw new Error('Public Life Community bucket must be an integer >= 60 seconds');
  }

  const groups = new Map<string, MutableAggregate>();
  let ignoredOpenEpisodes = 0;
  let ignoredLowConfidenceEpisodes = 0;

  for (const episode of episodes) {
    if (episode.endMs === undefined) {
      ignoredOpenEpisodes += 1;
      continue;
    }
    if (episode.confidence < minEpisodeConfidence) {
      ignoredLowConfidenceEpisodes += 1;
      continue;
    }
    if (
      !Number.isFinite(episode.startMs)
      || !Number.isFinite(episode.endMs)
      || !(episode.endMs > episode.startMs)
    ) continue;

    const startEpochMs = options.timestampToEpochMs(episode.startMs);
    const endEpochMs = options.timestampToEpochMs(episode.endMs);
    if (
      !Number.isSafeInteger(startEpochMs)
      || !Number.isSafeInteger(endEpochMs)
      || startEpochMs < 0
      || !(endEpochMs > startEpochMs)
    ) {
      throw new Error('timestampToEpochMs must produce ordered non-negative integer epoch milliseconds');
    }

    const activityClass = publicLifeActivityClassForPredicate(episode.predicate);
    const elementClass = episodeElementClass(episode, options.elementTypeForId);
    const participantCount = new Set(episode.trackIds).size;
    if (participantCount === 0) continue;

    let cursor = Math.floor(startEpochMs / bucketMs) * bucketMs;
    while (cursor < endEpochMs) {
      const bucketEndMs = cursor + bucketMs;
      const overlapStart = Math.max(startEpochMs, cursor);
      const overlapEnd = Math.min(endEpochMs, bucketEndMs);
      const overlapSeconds = Math.max(0, overlapEnd - overlapStart) / 1000;
      if (overlapSeconds > 0) {
        const key = bucketKey(cursor, activityClass, elementClass);
        let group = groups.get(key);
        if (!group) {
          group = {
            bucketStartMs: cursor,
            bucketEndMs,
            activityClass,
            elementClass,
            episodeIds: new Set(),
            entityIds: new Set(),
            totalDurationSeconds: 0,
            participantTimeSeconds: 0,
            qualityWeightedSeconds: 0,
            qualityWeightSeconds: 0,
          };
          groups.set(key, group);
        }
        group.episodeIds.add(episode.episodeId);
        for (const trackId of episode.trackIds) group.entityIds.add(trackId);
        group.totalDurationSeconds += overlapSeconds;
        group.participantTimeSeconds += overlapSeconds * participantCount;
        group.qualityWeightedSeconds += overlapSeconds * clamp01(episode.confidence);
        group.qualityWeightSeconds += overlapSeconds;
      }
      cursor = bucketEndMs;
    }
  }

  const records: PublicLifeAggregate[] = [];
  let suppressedGroupCount = 0;
  let suppressedEpisodeContributions = 0;

  for (const group of groups.values()) {
    const episodeCount = group.episodeIds.size;
    const uniqueEntities = group.entityIds.size;
    if (episodeCount < minEpisodes || uniqueEntities < minUniqueEntities) {
      suppressedGroupCount += 1;
      suppressedEpisodeContributions += episodeCount;
      continue;
    }

    records.push({
      schemaVersion: '2.0',
      aggregateType: 'public_life',
      bucketStartMs: group.bucketStartMs,
      bucketEndMs: group.bucketEndMs,
      activityClass: group.activityClass,
      elementClass: group.elementClass,
      uniqueEntities,
      episodeCount,
      totalDurationSeconds: roundDuration(
        group.totalDurationSeconds,
        durationQuantumSeconds,
      ),
      participantTimeSeconds: roundDuration(
        group.participantTimeSeconds,
        durationQuantumSeconds,
      ),
      meanQuality: group.qualityWeightSeconds <= 0
        ? 0
        : clamp01(group.qualityWeightedSeconds / group.qualityWeightSeconds),
    });
  }

  records.sort((a, b) => (
    a.bucketStartMs - b.bucketStartMs
    || a.activityClass.localeCompare(b.activityClass)
    || a.elementClass.localeCompare(b.elementClass)
  ));

  return {
    records,
    suppressedGroupCount,
    suppressedEpisodeContributions,
    ignoredOpenEpisodes,
    ignoredLowConfidenceEpisodes,
  };
}

export function communityElementClassForLocalType(
  localType: string | undefined,
): PublicLifeElementClass {
  return normalizeElementType(localType);
}
