import { describe, expect, it } from 'vitest';
import { RelationTemporalPersistence } from '../../src/relations/temporalPersistence';
import type { RelationFrameState } from '../../src/relations/types';

function evaluated(
  timestampMs: number,
  score: number,
  overrides: Partial<RelationFrameState> = {},
): RelationFrameState {
  return {
    subjectId: 't_1',
    subjectKind: 'track',
    objectId: 'bench_01',
    objectKind: 'static_element',
    predicate: 'sitting on',
    timestampMs,
    evaluability: 'evaluated',
    score,
    ...overrides,
  };
}

function unobservable(
  timestampMs: number,
  evaluability: RelationFrameState['evaluability'] = 'subject_not_observable',
): RelationFrameState {
  return {
    subjectId: 't_1',
    subjectKind: 'track',
    objectId: 'bench_01',
    objectKind: 'static_element',
    predicate: 'sitting on',
    timestampMs,
    evaluability,
  };
}

describe('relation temporal persistence', () => {
  it('opens an episode only after sustained positive evidence and closes on evaluated negative evidence', () => {
    const persistence = new RelationTemporalPersistence('session_1', {
      minOpenSamples: 2,
      scoreSmoothing: 1,
    });

    expect(persistence.update([evaluated(0, 0.9)], 0).activeRelations).toHaveLength(0);

    const opened = persistence.update([evaluated(100, 0.8)], 100);
    expect(opened.activeRelations).toHaveLength(1);
    expect(opened.activeRelations[0]?.startMs).toBe(0);

    const closed = persistence.update([evaluated(200, 0.1)], 200);
    expect(closed.activeRelations).toHaveLength(0);
    expect(closed.completedEpisodes).toHaveLength(1);
    expect(closed.completedEpisodes[0]).toMatchObject({
      sessionId: 'session_1',
      startMs: 0,
      endMs: 200,
      predicate: 'sitting on',
      trackIds: ['t_1'],
      semanticElementIds: ['bench_01'],
      sourceObservationCount: 3,
    });
  });

  it('does not interpret a missing evaluation as negative evidence', () => {
    const persistence = new RelationTemporalPersistence('session_1', {
      minOpenSamples: 1,
      scoreSmoothing: 1,
      maxUnobservableMs: 1000,
    });

    persistence.update([evaluated(0, 0.9)], 0);
    const noEvaluation = persistence.update([], 5000);

    expect(noEvaluation.completedEpisodes).toEqual([]);
    expect(noEvaluation.activeRelations).toHaveLength(1);
  });

  it('allows a short endpoint occlusion without fragmenting the episode', () => {
    const persistence = new RelationTemporalPersistence('session_1', {
      minOpenSamples: 1,
      scoreSmoothing: 1,
      maxUnobservableMs: 1000,
    });

    persistence.update([evaluated(0, 0.9)], 0);
    persistence.update([unobservable(100)], 100);

    const beforeTimeout = persistence.update([], 1000);
    expect(beforeTimeout.activeRelations).toHaveLength(1);
    expect(beforeTimeout.completedEpisodes).toEqual([]);

    const afterTimeout = persistence.update([], 1200);
    expect(afterTimeout.activeRelations).toHaveLength(0);
    expect(afterTimeout.completedEpisodes).toHaveLength(1);
    expect(afterTimeout.completedEpisodes[0]?.endMs).toBe(100);
  });

  it('recovers after short occlusion when positive evidence returns', () => {
    const persistence = new RelationTemporalPersistence('session_1', {
      minOpenSamples: 1,
      scoreSmoothing: 1,
      maxUnobservableMs: 1000,
    });

    persistence.update([evaluated(0, 0.9)], 0);
    persistence.update([unobservable(100)], 100);
    const recovered = persistence.update([evaluated(700, 0.85)], 700);

    expect(recovered.completedEpisodes).toEqual([]);
    expect(recovered.activeRelations[0]?.startMs).toBe(0);
    expect(recovered.activeRelations[0]?.lastEvaluatedMs).toBe(700);
  });

  it('supports track-to-track episodes without inventing semantic elements', () => {
    const persistence = new RelationTemporalPersistence('session_1', {
      minOpenSamples: 1,
      scoreSmoothing: 1,
    });

    persistence.update([
      evaluated(0, 0.9, {
        objectId: 't_2',
        objectKind: 'track',
        predicate: 'talking to',
      }),
    ], 0);

    const episodes = persistence.flush(1000);
    expect(episodes[0]).toMatchObject({
      trackIds: ['t_1', 't_2'],
      semanticElementIds: [],
      predicate: 'talking to',
      startMs: 0,
      endMs: 1000,
    });
  });
});
