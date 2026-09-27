import { describe, expect, it } from 'vitest';
import {
  aggregatePublicLifeForCommunity,
  communityElementClassForLocalType,
  publicLifeActivityClassForPredicate,
} from '../../src/community/publicLifeAggregation';
import type { ActivityEpisode } from '../../src/relations/types';

function episode(
  id: string,
  startMs: number,
  endMs: number | undefined,
  trackIds: string[],
  predicate: string,
  semanticElementIds: string[] = [],
  confidence = 0.9,
): ActivityEpisode {
  return {
    episodeId: id,
    sessionId: 'session-1',
    startMs,
    ...(endMs === undefined ? {} : { endMs }),
    trackIds,
    predicate,
    semanticElementIds,
    confidence,
    sourceObservationCount: 4,
  };
}

describe('Public Life Community aggregation', () => {
  it('maps relation predicates and local element types to coarse public classes', () => {
    expect(publicLifeActivityClassForPredicate('sitting on')).toBe('seated_use');
    expect(publicLifeActivityClassForPredicate('talking to')).toBe('social_interaction');
    expect(publicLifeActivityClassForPredicate('unknown custom predicate'))
      .toBe('other_observed_relation');

    expect(communityElementClassForLocalType('bench')).toBe('seating');
    expect(communityElementClassForLocalType('planter_edge')).toBe('edge_support');
    expect(communityElementClassForLocalType('tree')).toBe('greenery');
  });

  it('consumes exact ids locally but returns only coarse suppressed-safe records', () => {
    const episodes = [
      episode('e-1', 0, 60_000, ['track-a'], 'sitting on', ['bench-01']),
      episode('e-2', 10_000, 70_000, ['track-b'], 'sitting on', ['bench-02']),
      episode('e-3', 20_000, 80_000, ['track-c'], 'sitting on', ['bench-03']),
    ];

    const result = aggregatePublicLifeForCommunity(episodes, {
      timestampToEpochMs: (value) => 1_800_000_000_000 + value,
      elementTypeForId: () => 'bench',
      bucketMs: 5 * 60_000,
    });

    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      aggregateType: 'public_life',
      activityClass: 'seated_use',
      elementClass: 'seating',
      uniqueEntities: 3,
      episodeCount: 3,
      totalDurationSeconds: 180,
      participantTimeSeconds: 180,
    });

    const serialized = JSON.stringify(result.records[0]);
    expect(serialized).not.toContain('track-a');
    expect(serialized).not.toContain('bench-01');
    expect(serialized).not.toContain('e-1');
  });

  it('suppresses groups below both privacy floors', () => {
    const result = aggregatePublicLifeForCommunity([
      episode('e-1', 0, 60_000, ['track-a'], 'sitting on', ['bench-01']),
      episode('e-2', 10_000, 70_000, ['track-b'], 'sitting on', ['bench-02']),
    ], {
      timestampToEpochMs: (value) => 1_800_000_000_000 + value,
      elementTypeForId: () => 'bench',
    });

    expect(result.records).toEqual([]);
    expect(result.suppressedGroupCount).toBe(1);
    expect(result.suppressedEpisodeContributions).toBe(2);
  });

  it('counts participant-time for social relations without exposing pair identities', () => {
    const result = aggregatePublicLifeForCommunity([
      episode('e-1', 0, 60_000, ['a', 'b'], 'talking to'),
      episode('e-2', 0, 60_000, ['b', 'c'], 'talking to'),
      episode('e-3', 0, 60_000, ['a', 'c'], 'talking to'),
    ], {
      timestampToEpochMs: (value) => 1_800_000_000_000 + value,
    });

    expect(result.records[0]).toMatchObject({
      activityClass: 'social_interaction',
      elementClass: 'none',
      uniqueEntities: 3,
      episodeCount: 3,
      totalDurationSeconds: 180,
      participantTimeSeconds: 360,
    });
  });

  it('splits long episodes across coarse time buckets', () => {
    const episodes = [
      episode('e-1', 0, 120_000, ['a'], 'sitting on', ['bench-01']),
      episode('e-2', 0, 120_000, ['b'], 'sitting on', ['bench-02']),
      episode('e-3', 0, 120_000, ['c'], 'sitting on', ['bench-03']),
    ];

    const result = aggregatePublicLifeForCommunity(episodes, {
      timestampToEpochMs: (value) => 1_800_000_000_000 + value,
      elementTypeForId: () => 'bench',
      bucketMs: 60_000,
    });

    expect(result.records).toHaveLength(2);
    expect(result.records.map((record) => record.totalDurationSeconds)).toEqual([180, 180]);
  });

  it('ignores open and low-confidence episodes before aggregation', () => {
    const result = aggregatePublicLifeForCommunity([
      episode('open', 0, undefined, ['a'], 'sitting on', ['bench-01']),
      episode('low', 0, 60_000, ['b'], 'sitting on', ['bench-02'], 0.2),
    ], {
      timestampToEpochMs: (value) => 1_800_000_000_000 + value,
    });

    expect(result.records).toEqual([]);
    expect(result.ignoredOpenEpisodes).toBe(1);
    expect(result.ignoredLowConfidenceEpisodes).toBe(1);
  });
});
