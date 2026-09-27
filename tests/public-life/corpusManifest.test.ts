import { describe, expect, it } from 'vitest';
import {
  summarizePublicLifeCorpusCoverage,
  validatePublicLifeCorpusManifest,
  type PublicLifeCorpusManifest,
} from '../../src/public-life/corpusManifest';

const h = (character: string) => character.repeat(64);

function manifest(): PublicLifeCorpusManifest {
  return {
    schemaVersion: '1',
    corpusId: 'public-life-pilot',
    createdAtIso: '2026-09-27T00:00:00Z',
    annotationProtocolVersion: 'public-life-relations-v1',
    vocabularyId: 'public-life-v1',
    vocabularySha256: h('a'),
    sequences: [
      {
        sequenceId: 'seq-dev',
        annotationSha256: h('b'),
        mediaSha256: h('c'),
        semanticMapSha256: h('d'),
        split: 'development',
        siteId: 'site-001',
        spaceType: 'plaza',
        lighting: 'day',
        viewAngle: 'high_oblique',
        density: 'medium',
        occlusion: 'low',
        cameraStability: 'fixed',
        groundTruthMethod: 'single_annotator',
        durationMs: 120_000,
        targetPredicateIds: ['sitting_on', 'talking_to'],
        positiveEpisodeCounts: { sitting_on: 8, talking_to: 3 },
      },
      {
        sequenceId: 'seq-test',
        annotationSha256: h('e'),
        mediaSha256: h('f'),
        split: 'held_out_test',
        siteId: 'site-002',
        spaceType: 'park',
        lighting: 'backlight',
        viewAngle: 'medium_oblique',
        density: 'high',
        occlusion: 'medium',
        cameraStability: 'fixed',
        groundTruthMethod: 'independent_double',
        durationMs: 60_000,
        targetPredicateIds: ['sitting_on', 'talking_to'],
        positiveEpisodeCounts: { sitting_on: 2, talking_to: 1 },
      },
    ],
  };
}

describe('Public Life corpus manifest', () => {
  it('validates a split-aware reproducible corpus', () => {
    expect(() => validatePublicLifeCorpusManifest(manifest())).not.toThrow();
  });

  it('rejects media leakage across development and held-out test', () => {
    const value = manifest();
    const devMedia = value.sequences[0]?.mediaSha256;
    if (!devMedia || !value.sequences[1]) throw new Error('test fixture incomplete');
    value.sequences[1].mediaSha256 = devMedia;

    expect(() => validatePublicLifeCorpusManifest(value))
      .toThrow('Media file is reused across Public Life corpus splits');
  });

  it('rejects counts for predicates outside the declared annotation scope', () => {
    const value = manifest();
    const first = value.sequences[0];
    if (!first) throw new Error('test fixture incomplete');
    first.positiveEpisodeCounts = { sitting_on: 8, riding: 2 };

    expect(() => validatePublicLifeCorpusManifest(value))
      .toThrow('positiveEpisodeCounts contains non-target predicate riding');
  });

  it('summarizes predicate and held-out coverage without declaring scientific validity', () => {
    const coverage = summarizePublicLifeCorpusCoverage(manifest());

    expect(coverage.sequenceCount).toBe(2);
    expect(coverage.siteCount).toBe(2);
    expect(coverage.totalDurationMs).toBe(180_000);
    expect(coverage.splitCounts.held_out_test).toBe(1);
    expect(coverage.targetPredicateSequenceCounts.sitting_on).toBe(2);
    expect(coverage.positiveEpisodeCounts.sitting_on).toBe(10);
    expect(coverage.heldOutSitesSeenElsewhere).toEqual([]);
  });

  it('warns when a target predicate has no declared positive episodes', () => {
    const value = manifest();
    const first = value.sequences[0];
    const second = value.sequences[1];
    if (!first || !second) throw new Error('test fixture incomplete');
    first.targetPredicateIds.push('riding');
    second.targetPredicateIds.push('riding');

    const coverage = summarizePublicLifeCorpusCoverage(value);
    expect(coverage.findings).toContainEqual(expect.objectContaining({
      code: 'predicate_without_positive_episode',
      severity: 'warning',
    }));
  });

  it('warns when held-out ground truth is not independently checked', () => {
    const value = manifest();
    const heldOut = value.sequences[1];
    if (!heldOut) throw new Error('test fixture incomplete');
    heldOut.groundTruthMethod = 'single_annotator';

    const coverage = summarizePublicLifeCorpusCoverage(value);
    expect(coverage.findings).toContainEqual(expect.objectContaining({
      code: 'held_out_without_independent_ground_truth',
      severity: 'warning',
    }));
  });
});
