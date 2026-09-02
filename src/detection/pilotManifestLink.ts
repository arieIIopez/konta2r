import type { CorpusManifestSequence } from './corpusManifest';
import type { LocalManifestSequenceMetadata } from './localCorpusManifestBuilder';
import { validatePilotCaptureRecord, type PilotCaptureRecord } from './pilotCaptureRecord';

export function manifestMetadataFromPilotCapture(record: PilotCaptureRecord): LocalManifestSequenceMetadata {
  validatePilotCaptureRecord(record);
  return {
    split: record.plannedSplit,
    siteId: record.siteId,
    sceneType: record.scene.sceneType,
    lighting: record.scene.lighting,
    viewAngle: record.scene.viewAngle,
    deviceProfile: record.device.profile,
    tags: [
      'pilot_capture',
      `mount:${record.camera.mount}`,
      `through_glass:${record.scene.throughGlass}`,
      `reflections:${record.scene.reflections}`,
      `scene_occlusion:${record.scene.sceneOcclusion}`,
      `camera_stability:${record.scene.cameraStability}`,
    ],
    note: `captureId:${record.captureId}`,
  };
}

/**
 * Proves that a manifest entry prepared from local annotation/media bytes is
 * consistent with the field record declared before capture. The manifest does
 * not absorb the full field record; it keeps only the metadata needed by the
 * experimental corpus.
 */
export function verifyPilotCaptureManifestSequence(
  record: PilotCaptureRecord,
  sequence: CorpusManifestSequence,
): void {
  validatePilotCaptureRecord(record);
  if (record.media === undefined) {
    throw new Error('Pilot capture record has no media SHA-256; it cannot verify a manifest video sequence');
  }
  const checks: Array<[boolean, string]> = [
    [sequence.split === record.plannedSplit, `split mismatch: capture=${record.plannedSplit}, manifest=${sequence.split}`],
    [sequence.siteId === record.siteId, `siteId mismatch: capture=${record.siteId}, manifest=${sequence.siteId}`],
    [sequence.sceneType === record.scene.sceneType, `sceneType mismatch: capture=${record.scene.sceneType}, manifest=${sequence.sceneType}`],
    [sequence.lighting === record.scene.lighting, `lighting mismatch: capture=${record.scene.lighting}, manifest=${sequence.lighting}`],
    [sequence.viewAngle === record.scene.viewAngle, `viewAngle mismatch: capture=${record.scene.viewAngle}, manifest=${sequence.viewAngle}`],
    [sequence.deviceProfile === record.device.profile, `deviceProfile mismatch: capture=${record.device.profile}, manifest=${sequence.deviceProfile ?? 'undefined'}`],
    [sequence.mediaSha256?.toLowerCase() === record.media.sha256.toLowerCase(), 'media SHA-256 does not match the pilot capture record'],
  ];
  const failed = checks.find(([ok]) => !ok);
  if (failed) throw new Error(`Pilot capture / manifest mismatch: ${failed[1]}`);
}
