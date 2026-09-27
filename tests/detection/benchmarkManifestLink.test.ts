import { describe, expect, it } from 'vitest';
import {
  createBenchmarkManifestIdentity,
} from '../../src/detection/benchmarkManifestLink';
import type { CorpusManifest } from '../../src/detection/corpusManifest';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);
const D = 'd'.repeat(64);

const manifest: CorpusManifest = {
  schemaVersion: '1',
  corpusId: 'pilot-001',
  createdAtIso: '2026-08-31T15:00:00.000Z',
  sequences: [{
    sequenceId: 'seq-validation',
    annotationSha256: A,
    mediaSha256: B,
    split: 'validation',
    siteId: 'site-001',
    sceneType: 'mixed_traffic',
    lighting: 'day',
    viewAngle: 'medium_oblique',
  }],
};

describe('benchmark manifest link', () => {
  it('returns only corpus/split identity after matching frozen sequence hashes', () => {
    const identity = createBenchmarkManifestIdentity(manifest, {
      manifestSha256: C,
      sequenceId: 'seq-validation',
      annotationSha256: A,
      mediaSha256: B,
    });
    expect(identity).toEqual({ corpusId: 'pilot-001', sha256: C, split: 'validation' });
    expect('siteId' in identity).toBe(false);
  });

  it('rejects an annotation hash mismatch', () => {
    expect(() => createBenchmarkManifestIdentity(manifest, {
      manifestSha256: C, sequenceId: 'seq-validation', annotationSha256: D, mediaSha256: B,
    })).toThrow('Annotation SHA-256 does not match');
  });

  it('rejects a media hash mismatch including missing media evidence', () => {
    expect(() => createBenchmarkManifestIdentity(manifest, {
      manifestSha256: C, sequenceId: 'seq-validation', annotationSha256: A, mediaSha256: D,
    })).toThrow('Media SHA-256 does not match');
    expect(() => createBenchmarkManifestIdentity(manifest, {
      manifestSha256: C, sequenceId: 'seq-validation', annotationSha256: A,
    })).toThrow('Media SHA-256 does not match');
  });

  it('rejects a sequence absent from the frozen manifest', () => {
    expect(() => createBenchmarkManifestIdentity(manifest, {
      manifestSha256: C, sequenceId: 'missing', annotationSha256: A, mediaSha256: B,
    })).toThrow('is not present in corpus manifest');
  });
});
