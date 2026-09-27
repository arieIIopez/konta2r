import { describe, expect, it } from 'vitest';
import {
  createCorpusManifest,
  prepareLocalCorpusManifestSequence,
  serializeCorpusManifest,
} from '../../src/detection/localCorpusManifestBuilder';

const ABC_SHA256 = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

function annotationBlob(mediaSha256?: string): Blob {
  return new Blob([JSON.stringify({
    schemaVersion: '1',
    datasetId: 'pilot',
    sequenceId: 'seq-from-ground-truth',
    frames: [{
      frameId: 'frame-0001', timestampMs: 1000, mediaTimeMs: 1000,
      width: 640, height: 360, objects: [],
    }],
    ...(mediaSha256 === undefined ? {} : { source: { mediaSha256 } }),
  })], { type: 'application/json' });
}

const metadata = {
  split: 'development' as const,
  siteId: 'site-001',
  sceneType: 'mixed_traffic' as const,
  lighting: 'day' as const,
  viewAngle: 'medium_oblique' as const,
  deviceProfile: 'eco' as const,
};

describe('local corpus manifest builder', () => {
  it('derives sequenceId from annotations and hashes local annotation/media bytes', async () => {
    const progress: string[] = [];
    const prepared = await prepareLocalCorpusManifestSequence(
      { annotationBlob: annotationBlob(ABC_SHA256), mediaBlob: new Blob(['abc']) },
      metadata,
      { onProgress: (value) => progress.push(value.phase) },
    );
    expect(prepared.sequenceId).toBe('seq-from-ground-truth');
    expect(prepared.mediaSha256).toBe(ABC_SHA256);
    expect(prepared.annotationSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(progress).toContain('annotation');
    expect(progress).toContain('media');
  });

  it('rejects a local video that does not match source.mediaSha256 in ground truth', async () => {
    await expect(prepareLocalCorpusManifestSequence(
      { annotationBlob: annotationBlob(ABC_SHA256), mediaBlob: new Blob(['different']) },
      metadata,
    )).rejects.toThrow('Selected media SHA-256 does not match annotations');
  });

  it('requires media verification when ground truth already declares a media hash', async () => {
    await expect(prepareLocalCorpusManifestSequence(
      { annotationBlob: annotationBlob(ABC_SHA256) },
      metadata,
    )).rejects.toThrow('select the corresponding local media file');
  });

  it('allows annotation-only sequences when no media hash is declared', async () => {
    const prepared = await prepareLocalCorpusManifestSequence(
      { annotationBlob: annotationBlob() },
      { ...metadata, split: 'validation' },
    );
    expect(prepared.mediaSha256).toBeUndefined();
    expect(prepared.split).toBe('validation');
  });

  it('serializes only a manifest that passes cross-sequence leakage validation', async () => {
    const first = await prepareLocalCorpusManifestSequence(
      { annotationBlob: annotationBlob() }, metadata,
    );
    const manifest = createCorpusManifest('pilot-001', [first], '2026-08-31T15:30:00.000Z');
    expect(JSON.parse(serializeCorpusManifest(manifest))).toMatchObject({
      schemaVersion: '1', corpusId: 'pilot-001', sequences: [{ sequenceId: 'seq-from-ground-truth' }],
    });
  });
});
