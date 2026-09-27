import { describe, expect, it } from 'vitest';
import { parseCorpusManifestJson } from '../../src/detection/corpusManifestParser';

const h = (character: string) => character.repeat(64);

describe('corpus manifest parser', () => {
  it('rejects non-json and wrong schema versions', () => {
    expect(() => parseCorpusManifestJson('{')).toThrow('not valid JSON');
    expect(() => parseCorpusManifestJson(JSON.stringify({ schemaVersion: '2', sequences: [] })))
      .toThrow('schemaVersion must be 1');
  });

  it('rejects malformed tags instead of coercing them', () => {
    const raw = JSON.stringify({
      schemaVersion: '1', corpusId: 'pilot', createdAtIso: '2026-08-31T15:00:00Z',
      sequences: [{
        sequenceId: 'seq-1', annotationSha256: h('a'), split: 'development', siteId: 'site-1',
        sceneType: 'mixed_traffic', lighting: 'day', viewAngle: 'medium_oblique', tags: ['ok', 12],
      }],
    });
    expect(() => parseCorpusManifestJson(raw)).toThrow('tags[1] must be a non-empty string');
  });

  it('normalizes validation through the shared semantic validator', () => {
    const raw = JSON.stringify({
      schemaVersion: '1', corpusId: 'pilot', createdAtIso: '2026-08-31T15:00:00Z',
      sequences: [{
        sequenceId: 'seq-1', annotationSha256: h('a'), mediaSha256: h('b'), split: 'development',
        siteId: 'site-1', sceneType: 'intersection', lighting: 'night', viewAngle: 'high_oblique',
      }],
    });
    const parsed = parseCorpusManifestJson(raw);
    expect(parsed.sequences[0]).toMatchObject({
      sequenceId: 'seq-1', split: 'development', siteId: 'site-1', sceneType: 'intersection', lighting: 'night',
    });
  });
});
