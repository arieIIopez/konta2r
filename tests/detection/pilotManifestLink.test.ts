import { describe, expect, it } from 'vitest';
import type { CorpusManifestSequence } from '../../src/detection/corpusManifest';
import type { PilotCaptureRecord } from '../../src/detection/pilotCaptureRecord';
import {
  manifestMetadataFromPilotCapture,
  verifyPilotCaptureManifestSequence,
} from '../../src/detection/pilotManifestLink';

const MEDIA = 'b'.repeat(64);

function capture(): PilotCaptureRecord {
  return {
    schemaVersion: '1', recordType: 'konta2r_pilot_capture', captureId: 'cap-001', siteId: 'site-007', plannedSplit: 'validation',
    startedAtIso: '2026-08-31T17:00:00.000Z', durationSeconds: 600,
    scene: { sceneType: 'intersection', lighting: 'backlight', viewAngle: 'high_oblique', throughGlass: true,
      reflections: 'mixed', sceneOcclusion: 'poor', cameraStability: 'good' },
    camera: { width: 960, height: 540, frameRate: 24, orientation: 'landscape', mount: 'fixed' },
    device: { profile: 'balanced', hardwareConcurrency: 8, webgpu: true, powerSource: 'mains' },
    media: { sha256: MEDIA, sizeBytes: 1234, mimeType: 'video/webm' },
  };
}

function sequence(): CorpusManifestSequence {
  return {
    sequenceId: 'seq-001', annotationSha256: 'a'.repeat(64), mediaSha256: MEDIA,
    split: 'validation', siteId: 'site-007', sceneType: 'intersection', lighting: 'backlight',
    viewAngle: 'high_oblique', deviceProfile: 'balanced',
  };
}

describe('pilot capture / corpus manifest link', () => {
  it('derives corpus metadata from the predeclared field record', () => {
    const metadata = manifestMetadataFromPilotCapture(capture());
    expect(metadata).toMatchObject({
      split: 'validation', siteId: 'site-007', sceneType: 'intersection', lighting: 'backlight',
      viewAngle: 'high_oblique', deviceProfile: 'balanced',
    });
    expect(metadata.note).toBe('captureId:cap-001');
    expect(metadata.tags).toContain('through_glass:true');
  });

  it('accepts a sequence prepared from the same clip and declared design', () => {
    expect(() => verifyPilotCaptureManifestSequence(capture(), sequence())).not.toThrow();
  });

  it('rejects post-hoc split changes even when hashes match', () => {
    const value = sequence(); value.split = 'held_out_test';
    expect(() => verifyPilotCaptureManifestSequence(capture(), value)).toThrow('split mismatch');
  });

  it('rejects a different video even when other metadata matches', () => {
    const value = sequence(); value.mediaSha256 = 'c'.repeat(64);
    expect(() => verifyPilotCaptureManifestSequence(capture(), value)).toThrow('media SHA-256');
  });

  it('requires media identity in the field record for video linkage', () => {
    const value = capture(); delete value.media;
    expect(() => verifyPilotCaptureManifestSequence(value, sequence())).toThrow('no media SHA-256');
  });
});
