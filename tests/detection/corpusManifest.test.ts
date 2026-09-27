import { describe, expect, it } from 'vitest';
import {
  summarizeCorpusManifestCoverage,
  validateCorpusManifest,
  type CorpusManifest,
  type CorpusManifestSequence,
} from '../../src/detection/corpusManifest';
import { parseCorpusManifestJson } from '../../src/detection/corpusManifestParser';

const hash = (character: string) => character.repeat(64);

function sequence(overrides: Partial<CorpusManifestSequence> = {}): CorpusManifestSequence {
  return {
    sequenceId: 'seq-001',
    annotationSha256: hash('a'),
    mediaSha256: hash('b'),
    split: 'development',
    siteId: 'site-001',
    sceneType: 'mixed_traffic',
    lighting: 'day',
    viewAngle: 'medium_oblique',
    deviceProfile: 'balanced',
    ...overrides,
  };
}

function manifest(sequences: CorpusManifestSequence[]): CorpusManifest {
  return {
    schemaVersion: '1',
    corpusId: 'pilot-001',
    createdAtIso: '2026-08-31T15:00:00.000Z',
    sequences,
  };
}

describe('corpus manifest', () => {
  it('accepts separate development, validation and held-out sequences', () => {
    const value = manifest([
      sequence(),
      sequence({ sequenceId: 'seq-002', annotationSha256: hash('c'), mediaSha256: hash('d'), split: 'validation', siteId: 'site-002' }),
      sequence({ sequenceId: 'seq-003', annotationSha256: hash('e'), mediaSha256: hash('f'), split: 'held_out_test', siteId: 'site-003', deviceProfile: 'eco' }),
    ]);
    expect(() => validateCorpusManifest(value)).not.toThrow();
    const coverage = summarizeCorpusManifestCoverage(value);
    expect(coverage.splitCounts).toEqual({ development: 1, validation: 1, held_out_test: 1 });
    expect(coverage.heldOutSitesSeenElsewhere).toEqual([]);
    expect(coverage.deviceProfileCounts).toMatchObject({ balanced: 2, eco: 1 });
  });

  it('rejects reuse of identical annotation bytes across different splits', () => {
    const value = manifest([
      sequence(),
      sequence({ sequenceId: 'seq-002', split: 'held_out_test', siteId: 'site-002', mediaSha256: hash('c') }),
    ]);
    expect(() => validateCorpusManifest(value)).toThrow('Annotation file is reused across corpus splits');
  });

  it('rejects reuse of identical media bytes across different splits', () => {
    const value = manifest([
      sequence(),
      sequence({ sequenceId: 'seq-002', annotationSha256: hash('c'), split: 'held_out_test', siteId: 'site-002' }),
    ]);
    expect(() => validateCorpusManifest(value)).toThrow('Media file is reused across corpus splits');
  });

  it('rejects free-text/address-like and coordinate-like site identifiers', () => {
    expect(() => validateCorpusManifest(manifest([sequence({ siteId: 'Avenida Siempre Viva 123' })])))
      .toThrow('siteId must be an opaque');
    expect(() => validateCorpusManifest(manifest([sequence({ siteId: '33.4489_-70.6693' })])))
      .toThrow('precise latitude/longitude');
  });

  it('warns when held-out sites were already seen in another split', () => {
    const value = manifest([
      sequence(),
      sequence({ sequenceId: 'seq-002', annotationSha256: hash('c'), mediaSha256: hash('d'), split: 'held_out_test', siteId: 'site-001' }),
    ]);
    const coverage = summarizeCorpusManifestCoverage(value);
    expect(coverage.heldOutSitesSeenElsewhere).toEqual(['site-001']);
    expect(coverage.findings.some((finding) => finding.code === 'held_out_site_seen_elsewhere' && finding.severity === 'warning')).toBe(true);
  });

  it('parses untrusted JSON and preserves only the supported manifest contract', () => {
    const input = JSON.stringify({
      schemaVersion: '1',
      corpusId: 'pilot-001',
      createdAtIso: '2026-08-31T15:00:00.000Z',
      unexpected: 'ignored',
      sequences: [{
        sequenceId: 'seq-001',
        annotationSha256: hash('a'),
        mediaSha256: hash('b'),
        split: 'development',
        siteId: 'site-001',
        sceneType: 'intersection',
        lighting: 'backlight',
        viewAngle: 'high_oblique',
        deviceProfile: 'performance',
        tags: ['dense', 'morning'],
        unexpected: { preciseLocation: '-33,-70' },
      }],
    });
    const parsed = parseCorpusManifestJson(input);
    expect(parsed.sequences[0]?.sceneType).toBe('intersection');
    expect(parsed.sequences[0]?.tags).toEqual(['dense', 'morning']);
    expect('unexpected' in parsed).toBe(false);
    expect('unexpected' in (parsed.sequences[0] ?? {})).toBe(false);
  });

  it('rejects unsupported enum values during parsing', () => {
    const raw = JSON.stringify({
      schemaVersion: '1', corpusId: 'pilot', createdAtIso: '2026-08-31T15:00:00Z',
      sequences: [{
        sequenceId: 'seq-001', annotationSha256: hash('a'), split: 'production', siteId: 'site-001',
        sceneType: 'mixed_traffic', lighting: 'day', viewAngle: 'medium_oblique',
      }],
    });
    expect(() => parseCorpusManifestJson(raw)).toThrow('unsupported value production');
  });
});
