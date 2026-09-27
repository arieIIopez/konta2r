import { describe, expect, it } from 'vitest';
import {
  evaluatePublicLifeBenchmark,
  evaluatePublicLifeEpisodes,
  evaluatePublicLifeFrames,
  type PublicLifePredictedEpisode,
  type PublicLifePredictedRelation,
} from '../../src/public-life/benchmark';
import type { PublicLifeGroundTruthSequence } from '../../src/public-life/groundTruth';

function groundTruth(): PublicLifeGroundTruthSequence {
  return {
    schemaVersion: '1',
    sequenceId: 'seq-benchmark',
    annotationProtocolVersion: 'public-life-relations-v1',
    vocabularyId: 'public-life-v1',
    durationMs: 10_000,
    targetPredicateIds: ['sitting_on', 'talking_to'],
    endpoints: [
      { endpointId: 'person-1', kind: 'tracked_entity', entityType: 'person' },
      { endpointId: 'person-2', kind: 'tracked_entity', entityType: 'person' },
      { endpointId: 'person-3', kind: 'tracked_entity', entityType: 'person' },
      { endpointId: 'bench-1', kind: 'semantic_element', semanticElementId: 'bench_01' },
    ],
    frames: [
      {
        frameId: 'frame-1',
        timestampMs: 1_000,
        width: 1280,
        height: 720,
        endpoints: [
          { endpointId: 'person-1', visibility: 'visible', bbox: { x: 100, y: 200, width: 80, height: 200 } },
          { endpointId: 'person-2', visibility: 'visible', bbox: { x: 220, y: 200, width: 80, height: 200 } },
          { endpointId: 'person-3', visibility: 'visible', bbox: { x: 500, y: 200, width: 80, height: 200 } },
          { endpointId: 'bench-1', visibility: 'visible', bbox: { x: 80, y: 350, width: 260, height: 100 } },
        ],
        judgments: [
          {
            subjectId: 'person-1',
            objectId: 'bench-1',
            predicateId: 'sitting_on',
            label: 'positive',
          },
          {
            subjectId: 'person-1',
            objectId: 'person-2',
            predicateId: 'talking_to',
            label: 'negative',
          },
        ],
      },
      {
        frameId: 'frame-2',
        timestampMs: 2_000,
        width: 1280,
        height: 720,
        endpoints: [
          { endpointId: 'person-1', visibility: 'visible', bbox: { x: 100, y: 200, width: 80, height: 200 } },
          { endpointId: 'person-2', visibility: 'visible', bbox: { x: 220, y: 200, width: 80, height: 200 } },
          { endpointId: 'bench-1', visibility: 'visible', bbox: { x: 80, y: 350, width: 260, height: 100 } },
        ],
        judgments: [
          {
            subjectId: 'person-1',
            objectId: 'person-2',
            predicateId: 'talking_to',
            label: 'positive',
          },
          {
            subjectId: 'person-1',
            objectId: 'bench-1',
            predicateId: 'sitting_on',
            label: 'uncertain',
          },
        ],
      },
      {
        frameId: 'frame-3',
        timestampMs: 3_000,
        width: 1280,
        height: 720,
        endpoints: [
          { endpointId: 'person-1', visibility: 'not_observable' },
          { endpointId: 'bench-1', visibility: 'visible', bbox: { x: 80, y: 350, width: 260, height: 100 } },
        ],
        judgments: [
          {
            subjectId: 'person-1',
            objectId: 'bench-1',
            predicateId: 'sitting_on',
            label: 'not_observable',
          },
        ],
      },
    ],
    episodes: [
      {
        episodeId: 'episode-sit',
        subjectId: 'person-1',
        objectId: 'bench-1',
        predicateId: 'sitting_on',
        startMs: 500,
        endMs: 3_000,
        label: 'positive',
      },
      {
        episodeId: 'episode-talk-uncertain',
        subjectId: 'person-1',
        objectId: 'person-2',
        predicateId: 'talking_to',
        startMs: 4_000,
        endMs: 5_000,
        label: 'uncertain',
      },
    ],
  };
}

describe('Public Life frame benchmark', () => {
  it('scores only explicit positive/negative judgments', () => {
    const predictions: PublicLifePredictedRelation[] = [
      {
        frameId: 'frame-1',
        subjectId: 'person-1',
        objectId: 'bench-1',
        predicateId: 'sitting_on',
        score: 0.9,
      },
      {
        frameId: 'frame-1',
        subjectId: 'person-1',
        objectId: 'person-2',
        predicateId: 'talking_to',
        score: 0.8,
      },
      {
        frameId: 'frame-2',
        subjectId: 'person-2',
        objectId: 'person-1',
        predicateId: 'talking_to',
        score: 0.9,
      },
    ];

    const result = evaluatePublicLifeFrames(groundTruth(), predictions);
    const sitting = result.predicates.find((item) => item.predicateId === 'sitting_on');
    const talking = result.predicates.find((item) => item.predicateId === 'talking_to');

    expect(sitting).toMatchObject({
      truePositive: 1,
      falseNegative: 0,
      scoredJudgments: 1,
      uncertainJudgments: 1,
      notObservableJudgments: 1,
    });
    expect(talking).toMatchObject({
      truePositive: 1,
      falsePositive: 1,
      falseNegative: 0,
      trueNegative: 0,
      scoredJudgments: 2,
    });
  });

  it('normalizes symmetric predicates so reversed endpoints still match', () => {
    const predictions: PublicLifePredictedRelation[] = [
      {
        frameId: 'frame-2',
        subjectId: 'person-2',
        objectId: 'person-1',
        predicateId: 'talking_to',
        score: 0.9,
      },
    ];

    const result = evaluatePublicLifeFrames(groundTruth(), predictions);
    const talking = result.predicates.find((item) => item.predicateId === 'talking_to');

    expect(talking?.truePositive).toBe(1);
    expect(talking?.falseNegative).toBe(0);
  });

  it('reports predictions without explicit human judgment as unscored, not false positives', () => {
    const predictions: PublicLifePredictedRelation[] = [
      {
        frameId: 'frame-1',
        subjectId: 'person-3',
        objectId: 'bench-1',
        predicateId: 'sitting_on',
        score: 0.95,
      },
    ];

    const result = evaluatePublicLifeFrames(groundTruth(), predictions);
    const sitting = result.predicates.find((item) => item.predicateId === 'sitting_on');

    expect(sitting?.falsePositive).toBe(0);
    expect(sitting?.unscoredPredictions).toBe(1);
  });

  it('does not score uncertain or not-observable judgments as negatives', () => {
    const predictions: PublicLifePredictedRelation[] = [
      {
        frameId: 'frame-2',
        subjectId: 'person-1',
        objectId: 'bench-1',
        predicateId: 'sitting_on',
        score: 0.95,
      },
      {
        frameId: 'frame-3',
        subjectId: 'person-1',
        objectId: 'bench-1',
        predicateId: 'sitting_on',
        score: 0.95,
      },
    ];

    const result = evaluatePublicLifeFrames(groundTruth(), predictions);
    const sitting = result.predicates.find((item) => item.predicateId === 'sitting_on');

    expect(sitting?.falsePositive).toBe(0);
    expect(sitting?.unscoredPredictions).toBe(2);
  });

  it('rejects predictions that expand the frozen predicate scope', () => {
    expect(() => evaluatePublicLifeFrames(groundTruth(), [{
      frameId: 'frame-1',
      subjectId: 'person-1',
      objectId: 'bench-1',
      predicateId: 'using',
      score: 0.9,
    }])).toThrow('outside frozen target scope');
  });
});

describe('Public Life episode benchmark', () => {
  it('matches positive episodes and reports boundary/duration error', () => {
    const predictions: PublicLifePredictedEpisode[] = [
      {
        subjectId: 'person-1',
        objectId: 'bench-1',
        predicateId: 'sitting_on',
        startMs: 400,
        endMs: 3_200,
        score: 0.9,
      },
    ];

    const result = evaluatePublicLifeEpisodes(groundTruth(), predictions);

    expect(result.positiveGroundTruthEpisodes).toBe(1);
    expect(result.matchedPositiveEpisodes).toBe(1);
    expect(result.missedPositiveEpisodes).toBe(0);
    expect(result.positiveEpisodeRecall).toBe(1);
    expect(result.startMaeMs).toBe(100);
    expect(result.endMaeMs).toBe(200);
    expect(result.durationMaeMs).toBe(300);
  });

  it('reports extra overlapping fragments without naming them false positives', () => {
    const predictions: PublicLifePredictedEpisode[] = [
      {
        subjectId: 'person-1',
        objectId: 'bench-1',
        predicateId: 'sitting_on',
        startMs: 500,
        endMs: 1_800,
      },
      {
        subjectId: 'person-1',
        objectId: 'bench-1',
        predicateId: 'sitting_on',
        startMs: 1_700,
        endMs: 3_000,
      },
    ];

    const result = evaluatePublicLifeEpisodes(groundTruth(), predictions, {
      episodeMinTemporalIou: 0.2,
    });

    expect(result.matchedPositiveEpisodes).toBe(1);
    expect(result.fragmentationExcess).toBe(1);
    expect(result.unverifiedPredictedEpisodes).toBe(1);
  });

  it('keeps predictions over uncertain GT episodes unverified', () => {
    const predictions: PublicLifePredictedEpisode[] = [
      {
        subjectId: 'person-2',
        objectId: 'person-1',
        predicateId: 'talking_to',
        startMs: 4_000,
        endMs: 5_000,
      },
    ];

    const result = evaluatePublicLifeEpisodes(groundTruth(), predictions);

    expect(result.uncertainGroundTruthEpisodes).toBe(1);
    expect(result.unverifiedPredictedEpisodes).toBe(1);
    expect(result.matchedPositiveEpisodes).toBe(0);
  });
});

describe('Public Life A/B/C/D benchmark result', () => {
  it('packages frame and episode metrics under an explicit variant id', () => {
    const result = evaluatePublicLifeBenchmark(
      'C_hybrid',
      groundTruth(),
      [{
        frameId: 'frame-1',
        subjectId: 'person-1',
        objectId: 'bench-1',
        predicateId: 'sitting_on',
        score: 0.9,
      }],
      [{
        subjectId: 'person-1',
        objectId: 'bench-1',
        predicateId: 'sitting_on',
        startMs: 500,
        endMs: 3_000,
      }],
    );

    expect(result.variant).toBe('C_hybrid');
    expect(result.sequenceId).toBe('seq-benchmark');
    expect(result.frame.scoredJudgments).toBe(3);
    expect(result.episodes.matchedPositiveEpisodes).toBe(1);
  });
});
