import { describe, expect, it } from 'vitest';
import {
  summarizePublicLifeGroundTruth,
  validatePublicLifeGroundTruthSequence,
  type PublicLifeGroundTruthSequence,
} from '../../src/public-life/groundTruth';

function sequence(): PublicLifeGroundTruthSequence {
  return {
    schemaVersion: '1',
    sequenceId: 'seq-001',
    annotationProtocolVersion: 'public-life-relations-v1',
    vocabularyId: 'public-life-v1',
    durationMs: 10_000,
    targetPredicateIds: ['sitting_on', 'talking_to'],
    endpoints: [
      { endpointId: 'person-001', kind: 'tracked_entity', entityType: 'person' },
      { endpointId: 'person-002', kind: 'tracked_entity', entityType: 'person' },
      { endpointId: 'bench-001', kind: 'semantic_element', semanticElementId: 'bench_01' },
    ],
    frames: [
      {
        frameId: 'frame-001',
        timestampMs: 1_000,
        width: 1280,
        height: 720,
        endpoints: [
          {
            endpointId: 'person-001',
            visibility: 'visible',
            bbox: { x: 100, y: 200, width: 80, height: 200 },
          },
          {
            endpointId: 'person-002',
            visibility: 'visible',
            bbox: { x: 220, y: 200, width: 80, height: 200 },
          },
          {
            endpointId: 'bench-001',
            visibility: 'visible',
            bbox: { x: 80, y: 350, width: 260, height: 100 },
          },
        ],
        judgments: [
          {
            subjectId: 'person-001',
            objectId: 'bench-001',
            predicateId: 'sitting_on',
            label: 'positive',
          },
          {
            subjectId: 'person-001',
            objectId: 'person-002',
            predicateId: 'talking_to',
            label: 'negative',
          },
        ],
      },
      {
        frameId: 'frame-002',
        timestampMs: 2_000,
        width: 1280,
        height: 720,
        endpoints: [
          { endpointId: 'person-001', visibility: 'not_observable' },
          {
            endpointId: 'bench-001',
            visibility: 'visible',
            bbox: { x: 80, y: 350, width: 260, height: 100 },
          },
        ],
        judgments: [
          {
            subjectId: 'person-001',
            objectId: 'bench-001',
            predicateId: 'sitting_on',
            label: 'not_observable',
          },
        ],
      },
    ],
    episodes: [
      {
        episodeId: 'episode-001',
        subjectId: 'person-001',
        objectId: 'bench-001',
        predicateId: 'sitting_on',
        startMs: 500,
        endMs: 3_000,
        label: 'positive',
      },
    ],
  };
}

describe('Public Life ground truth', () => {
  it('validates explicit positive, negative and not-observable judgments', () => {
    expect(() => validatePublicLifeGroundTruthSequence(sequence())).not.toThrow();
  });

  it('does not allow missing visibility to become an implicit negative label', () => {
    const value = sequence();
    const frame = value.frames[1];
    const judgment = frame?.judgments[0];
    if (!judgment) throw new Error('test fixture incomplete');
    judgment.label = 'negative';

    expect(() => validatePublicLifeGroundTruthSequence(value))
      .toThrow('must label relation not_observable');
  });

  it('requires both endpoints to be explicitly observed in the annotated frame', () => {
    const value = sequence();
    const frame = value.frames[0];
    if (!frame) throw new Error('test fixture incomplete');
    frame.endpoints = frame.endpoints.filter((endpoint) => endpoint.endpointId !== 'person-002');

    expect(() => validatePublicLifeGroundTruthSequence(value))
      .toThrow('judgment endpoints must both have frame observations');
  });

  it('rejects unscoped predicates instead of silently expanding the experiment', () => {
    const value = sequence();
    const frame = value.frames[0];
    if (!frame) throw new Error('test fixture incomplete');
    frame.judgments.push({
      subjectId: 'person-001',
      objectId: 'bench-001',
      predicateId: 'using',
      label: 'positive',
    });

    expect(() => validatePublicLifeGroundTruthSequence(value))
      .toThrow('uses non-target predicate using');
  });

  it('summarizes frame judgments and positive episode duration', () => {
    const summary = summarizePublicLifeGroundTruth(sequence());

    expect(summary.frameCount).toBe(2);
    expect(summary.endpointCount).toBe(3);
    expect(summary.judgmentCounts.sitting_on).toMatchObject({
      positive: 1,
      not_observable: 1,
    });
    expect(summary.judgmentCounts.talking_to?.negative).toBe(1);
    expect(summary.positiveEpisodeDurationMs.sitting_on).toBe(2_500);
    expect(summary.predicatesWithoutNegativeFrames).toContain('sitting_on');
    expect(summary.predicatesWithoutPositiveFrames).toContain('talking_to');
  });

  it('rejects episodes that extend beyond the annotated sequence', () => {
    const value = sequence();
    const episode = value.episodes[0];
    if (!episode) throw new Error('test fixture incomplete');
    episode.endMs = 11_000;

    expect(() => validatePublicLifeGroundTruthSequence(value))
      .toThrow('exceeds sequence duration');
  });
});
