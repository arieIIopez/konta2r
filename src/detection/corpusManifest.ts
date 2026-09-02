export type CorpusSplit = 'development' | 'validation' | 'held_out_test';
export type CorpusSceneType =
  | 'protected_cycleway'
  | 'unprotected_cycleway'
  | 'mixed_traffic'
  | 'intersection'
  | 'sidewalk'
  | 'transit_corridor'
  | 'shared_space'
  | 'other';
export type CorpusLighting = 'day' | 'backlight' | 'dusk_dawn' | 'night' | 'mixed';
export type CorpusViewAngle = 'low_oblique' | 'medium_oblique' | 'high_oblique' | 'near_overhead' | 'other';
export type CorpusDeviceProfile = 'eco' | 'balanced' | 'performance' | 'unknown';

export interface CorpusManifestSequence {
  sequenceId: string;
  annotationSha256: string;
  mediaSha256?: string;
  split: CorpusSplit;
  /**
   * Opaque site pseudonym such as `site-001` or `rm-seg-a17`. It is not a
   * street address, household coordinate or free-text place description.
   */
  siteId: string;
  sceneType: CorpusSceneType;
  lighting: CorpusLighting;
  viewAngle: CorpusViewAngle;
  deviceProfile?: CorpusDeviceProfile;
  tags?: string[];
  note?: string;
}

export interface CorpusManifest {
  schemaVersion: '1';
  corpusId: string;
  createdAtIso: string;
  sequences: CorpusManifestSequence[];
  note?: string;
}

const SHA256 = /^[a-f0-9]{64}$/i;
const OPAQUE_SITE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
export const CORPUS_SPLITS: readonly CorpusSplit[] = ['development', 'validation', 'held_out_test'];
export const CORPUS_SCENE_TYPES: readonly CorpusSceneType[] = [
  'protected_cycleway', 'unprotected_cycleway', 'mixed_traffic', 'intersection',
  'sidewalk', 'transit_corridor', 'shared_space', 'other',
];
export const CORPUS_LIGHTING: readonly CorpusLighting[] = ['day', 'backlight', 'dusk_dawn', 'night', 'mixed'];
export const CORPUS_VIEW_ANGLES: readonly CorpusViewAngle[] = ['low_oblique', 'medium_oblique', 'high_oblique', 'near_overhead', 'other'];
export const CORPUS_DEVICE_PROFILES: readonly CorpusDeviceProfile[] = ['eco', 'balanced', 'performance', 'unknown'];

function nonEmpty(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error(`${label} is required`);
  return normalized;
}

function validHash(value: string, label: string): string {
  const normalized = nonEmpty(value, label).toLowerCase();
  if (!SHA256.test(normalized)) throw new Error(`${label} must be a SHA-256 hex digest`);
  return normalized;
}

function containsCoordinateLike(value: string): boolean {
  const decimals = value.match(/-?\d{1,3}\.\d{4,}/g);
  return (decimals?.length ?? 0) >= 2;
}

function validateSiteId(siteId: string): string {
  const value = nonEmpty(siteId, 'siteId');
  if (!OPAQUE_SITE_ID.test(value)) {
    throw new Error('siteId must be an opaque 1-64 character token using only letters, numbers, dot, underscore or hyphen');
  }
  if (containsCoordinateLike(value)) {
    throw new Error('siteId must not encode precise latitude/longitude coordinates');
  }
  return value;
}

function validateOptionalText(value: string | undefined, label: string, maxLength: number): void {
  if (value === undefined) return;
  const normalized = nonEmpty(value, label);
  if (normalized.length > maxLength) throw new Error(`${label} must be ${maxLength} characters or fewer`);
}

export function validateCorpusManifest(manifest: CorpusManifest): void {
  if (manifest.schemaVersion !== '1') throw new Error('Unsupported corpus manifest schemaVersion');
  nonEmpty(manifest.corpusId, 'corpusId');
  if (Number.isNaN(Date.parse(manifest.createdAtIso))) throw new Error('createdAtIso must be a valid ISO date');
  if (manifest.sequences.length === 0) throw new Error('Corpus manifest must contain at least one sequence');
  validateOptionalText(manifest.note, 'manifest note', 2_000);

  const sequenceIds = new Set<string>();
  const annotationHashes = new Map<string, CorpusSplit>();
  const mediaHashes = new Map<string, CorpusSplit>();

  for (const sequence of manifest.sequences) {
    const sequenceId = nonEmpty(sequence.sequenceId, 'sequenceId');
    if (sequenceIds.has(sequenceId)) throw new Error(`Duplicate sequenceId ${sequenceId}`);
    sequenceIds.add(sequenceId);

    const annotationHash = validHash(sequence.annotationSha256, `sequence ${sequenceId} annotationSha256`);
    const mediaHash = sequence.mediaSha256 === undefined
      ? undefined
      : validHash(sequence.mediaSha256, `sequence ${sequenceId} mediaSha256`);
    validateSiteId(sequence.siteId);
    if (!CORPUS_SPLITS.includes(sequence.split)) throw new Error(`Unsupported corpus split ${sequence.split}`);
    if (!CORPUS_SCENE_TYPES.includes(sequence.sceneType)) throw new Error(`Unsupported sceneType ${sequence.sceneType}`);
    if (!CORPUS_LIGHTING.includes(sequence.lighting)) throw new Error(`Unsupported lighting ${sequence.lighting}`);
    if (!CORPUS_VIEW_ANGLES.includes(sequence.viewAngle)) throw new Error(`Unsupported viewAngle ${sequence.viewAngle}`);
    if (sequence.deviceProfile !== undefined && !CORPUS_DEVICE_PROFILES.includes(sequence.deviceProfile)) {
      throw new Error(`Unsupported deviceProfile ${sequence.deviceProfile}`);
    }
    validateOptionalText(sequence.note, `sequence ${sequenceId} note`, 1_000);

    const priorAnnotationSplit = annotationHashes.get(annotationHash);
    if (priorAnnotationSplit !== undefined && priorAnnotationSplit !== sequence.split) {
      throw new Error(`Annotation file is reused across corpus splits: ${sequenceId}`);
    }
    annotationHashes.set(annotationHash, sequence.split);

    if (mediaHash !== undefined) {
      const priorMediaSplit = mediaHashes.get(mediaHash);
      if (priorMediaSplit !== undefined && priorMediaSplit !== sequence.split) {
        throw new Error(`Media file is reused across corpus splits: ${sequenceId}`);
      }
      mediaHashes.set(mediaHash, sequence.split);
    }

    if (sequence.tags) {
      const tags = new Set<string>();
      for (const rawTag of sequence.tags) {
        const tag = nonEmpty(rawTag, `sequence ${sequenceId} tag`);
        if (tag.length > 80) throw new Error(`Tag ${tag} in sequence ${sequenceId} is longer than 80 characters`);
        if (tags.has(tag)) throw new Error(`Duplicate tag ${tag} in sequence ${sequenceId}`);
        tags.add(tag);
      }
    }
  }
}

export interface CorpusManifestCoverage {
  sequenceCount: number;
  siteCount: number;
  splitCounts: Record<CorpusSplit, number>;
  sceneTypeCounts: Partial<Record<CorpusSceneType, number>>;
  lightingCounts: Partial<Record<CorpusLighting, number>>;
  viewAngleCounts: Partial<Record<CorpusViewAngle, number>>;
  deviceProfileCounts: Partial<Record<CorpusDeviceProfile, number>>;
  sitesAcrossMultipleSplits: string[];
  heldOutSitesSeenElsewhere: string[];
  findings: Array<{
    severity: 'info' | 'warning';
    code:
      | 'missing_held_out_test'
      | 'single_site'
      | 'site_crosses_splits'
      | 'held_out_site_seen_elsewhere'
      | 'scene_type_absent'
      | 'lighting_absent'
      | 'device_profile_absent';
    message: string;
  }>;
}

function increment<T extends string>(record: Partial<Record<T, number>>, key: T): void {
  record[key] = (record[key] ?? 0) + 1;
}

/** Describes corpus design coverage; it deliberately does not declare the
 * corpus scientifically valid or invalid. */
export function summarizeCorpusManifestCoverage(manifest: CorpusManifest): CorpusManifestCoverage {
  validateCorpusManifest(manifest);
  const splitCounts: Record<CorpusSplit, number> = { development: 0, validation: 0, held_out_test: 0 };
  const sceneTypeCounts: Partial<Record<CorpusSceneType, number>> = {};
  const lightingCounts: Partial<Record<CorpusLighting, number>> = {};
  const viewAngleCounts: Partial<Record<CorpusViewAngle, number>> = {};
  const deviceProfileCounts: Partial<Record<CorpusDeviceProfile, number>> = {};
  const siteSplits = new Map<string, Set<CorpusSplit>>();

  for (const sequence of manifest.sequences) {
    splitCounts[sequence.split] += 1;
    increment(sceneTypeCounts, sequence.sceneType);
    increment(lightingCounts, sequence.lighting);
    increment(viewAngleCounts, sequence.viewAngle);
    increment(deviceProfileCounts, sequence.deviceProfile ?? 'unknown');
    const splits = siteSplits.get(sequence.siteId) ?? new Set<CorpusSplit>();
    splits.add(sequence.split);
    siteSplits.set(sequence.siteId, splits);
  }

  const sitesAcrossMultipleSplits = [...siteSplits.entries()]
    .filter(([, splits]) => splits.size > 1)
    .map(([siteId]) => siteId)
    .sort();
  const heldOutSitesSeenElsewhere = [...siteSplits.entries()]
    .filter(([, splits]) => splits.has('held_out_test') && (splits.has('development') || splits.has('validation')))
    .map(([siteId]) => siteId)
    .sort();
  const findings: CorpusManifestCoverage['findings'] = [];

  if (splitCounts.held_out_test === 0) {
    findings.push({
      severity: 'warning', code: 'missing_held_out_test',
      message: 'El manifest no contiene secuencias held_out_test; no hay un conjunto reservado para evaluación final.',
    });
  }
  if (siteSplits.size < 2) {
    findings.push({
      severity: 'warning', code: 'single_site',
      message: 'Todas las secuencias provienen de un único siteId; el corpus no describe variación entre ubicaciones.',
    });
  }
  if (sitesAcrossMultipleSplits.length > 0) {
    findings.push({
      severity: 'info', code: 'site_crosses_splits',
      message: `${sitesAcrossMultipleSplits.length} siteId(s) aparecen en más de un split. Esto puede ser deliberado, pero introduce dependencia visual entre conjuntos.`,
    });
  }
  if (heldOutSitesSeenElsewhere.length > 0) {
    findings.push({
      severity: 'warning', code: 'held_out_site_seen_elsewhere',
      message: `${heldOutSitesSeenElsewhere.length} siteId(s) del held_out_test aparecen también en development/validation; el test final no evalúa generalización a sitios completamente no vistos.`,
    });
  }
  for (const sceneType of CORPUS_SCENE_TYPES) {
    if ((sceneTypeCounts[sceneType] ?? 0) === 0) {
      findings.push({ severity: 'info', code: 'scene_type_absent', message: `No hay secuencias etiquetadas como ${sceneType}.` });
    }
  }
  for (const lighting of CORPUS_LIGHTING) {
    if ((lightingCounts[lighting] ?? 0) === 0) {
      findings.push({ severity: 'info', code: 'lighting_absent', message: `No hay secuencias con condición de iluminación ${lighting}.` });
    }
  }
  for (const profile of CORPUS_DEVICE_PROFILES) {
    if ((deviceProfileCounts[profile] ?? 0) === 0) {
      findings.push({ severity: 'info', code: 'device_profile_absent', message: `No hay secuencias asociadas al perfil de dispositivo ${profile}.` });
    }
  }

  return {
    sequenceCount: manifest.sequences.length,
    siteCount: siteSplits.size,
    splitCounts,
    sceneTypeCounts,
    lightingCounts,
    viewAngleCounts,
    deviceProfileCounts,
    sitesAcrossMultipleSplits,
    heldOutSitesSeenElsewhere,
    findings,
  };
}
