import { describe, expect, it } from 'vitest';
import type { AnnotatedBenchmarkSequence } from '../../src/detection/benchmarkDataset';
import {
  assertBenchmarkProfileMatchesManifestSplit,
  verifyLocalBenchmarkManifest,
} from '../../src/detection/localBenchmarkManifest';
import { sha256BlobHex } from '../../src/core/sha256';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

const sequence: AnnotatedBenchmarkSequence = {
  schemaVersion: '1', datasetId: 'pilot', sequenceId: 'seq-validation',
  frames: [{ frameId: 'f1', timestampMs: 1, width: 10, height: 10, objects: [] }],
};

function blob(split: 'development' | 'validation' | 'held_out_test' = 'validation'): Blob {
  return new Blob([JSON.stringify({
    schemaVersion: '1', corpusId: 'pilot-manifest', createdAtIso: '2026-08-31T15:00:00.000Z',
    sequences: [{
      sequenceId: 'seq-validation', annotationSha256: A, mediaSha256: B, split,
      siteId: 'site-001', sceneType: 'mixed_traffic', lighting: 'day', viewAngle: 'medium_oblique',
    }],
  })], { type: 'application/json' });
}

describe('local benchmark manifest', () => {
  it('hashes exact manifest bytes and verifies the sequence entry', async () => {
    const file = blob('validation');
    const expected = await sha256BlobHex(file);
    const result = await verifyLocalBenchmarkManifest(file, sequence, A, B);
    expect(result.manifestSha256).toBe(expected);
    expect(result.identity).toEqual({ corpusId: 'pilot-manifest', sha256: expected, split: 'validation' });
  });

  it('rejects sequence/hash mismatch before benchmark inference', async () => {
    await expect(verifyLocalBenchmarkManifest(blob(), sequence, 'c'.repeat(64), B))
      .rejects.toThrow('Annotation SHA-256 does not match');
  });

  it('enforces profile-to-split preflight', () => {
    expect(() => assertBenchmarkProfileMatchesManifestSplit('selection', {
      corpusId: 'c', sha256: A, split: 'validation',
    })).not.toThrow();
    expect(() => assertBenchmarkProfileMatchesManifestSplit('selection', {
      corpusId: 'c', sha256: A, split: 'held_out_test',
    })).toThrow('selection requires validation split');
    expect(() => assertBenchmarkProfileMatchesManifestSplit('final_evaluation', {
      corpusId: 'c', sha256: A, split: 'held_out_test',
    })).not.toThrow();
    expect(() => assertBenchmarkProfileMatchesManifestSplit('final_evaluation', undefined))
      .toThrow('requires a verified corpus manifest');
  });
});
