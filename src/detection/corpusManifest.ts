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

export interface CorpusManifestSequence {
  sequenceId: string;
  annotationSha256: string;
  mediaSha256?: string;
  split: CorpusSplit;
  /** Segment/site pseudonym. Must not contain a household address or exact coordinate. */
  siteId: string;
  sceneType: CorpusSceneType;
  lighting: CorpusLighting;
  viewAngle: CorpusViewAngle;
  deviceProfile?: 'eco' | 'balanced' | 'performance' | 'unknown';
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
const SPLITS: readonly CorpusSplit[] = ['development', 'validation', 'held_out_test'];
const SCENE_TYPES: readonly CorpusSceneType[] = [
  'protected_cycleway', 'unprotected_cycleway', 'mixed_traffic', 'intersection',
  'sidewalk', 'transit_corridor', 'shared_space', 'other',
];
const LIGHTING: readonly CorpusLighting[] = ['day', 'backlight', 'dusk_dawn', 'night', 'mixed'];
const VIEW_ANGLES: readonly CorpusViewAngle[] = ['low_oblique', 'medium_oblique', 'high_oblique', 'near_overhead', 'other'];

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

function containsPreciseCoordinateLike(value: string): boolean {
  // Privacy guardrail, not a full geocoding/privacy detector. Rejects common raw
  // decimal lat,long pairs so the manifest contract does not casually become a
  // household-location database.
  return /-?\d{1,2}\.\d{4,}\s*[,;]\s*-?\d{1,3}\.\d{4,}/.test(value);
}

function validateSiteId(siteId: string): string {
  const value = nonEmpty(siteId, 'siteId');
  if (containsPreciseCoordinateLike(value)) {
    throw new Error('siteId must not contain precise latitude/longitude coordinates');
  }
  if (value.length > 120) throw new Error('siteId must be 120 characters or fewer');
  return value;
}

export function validateCorpusManifest(manifest: CorpusManifest): void {
  if (manifest.schemaVersion !== '1') throw new Error('Unsupported corpus manifest schemaVersion');
  nonEmpty(manifest.corpusId, 'corpusId');
  if (Number.isNaN(Date.parse(manifest.createdAtIso))) throw new Error('createdAtIso must be a valid ISO date');
  if (manifest.sequences.length === 0) throw new Error('Corpus manifest must contain at least one sequence');

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
    if (!SPLITS.includes(sequence.split)) throw new Error(`Unsupported corpus split ${sequence.split}`);
    if (!SCENE_TYPES.includes(sequence.sceneType)) throw new Error(`Unsupported sceneType ${sequence.sceneType}`);
    if (!LIGHTING.includes(sequence.lighting)) throw new Error(`Unsupported lighting ${sequence.lighting}`);
    if (!VIEW_ANGLES.includes(sequence.viewAngle)) throw new Error(`Unsupported viewAngle ${sequence.viewAngle}`);

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
  sitesAcrossMultipleSplits: string[];
  findings: Array<{
    severity: 'info' | 'warning';
    code: 'missing_held_out_test' | 'single_site' | 'site_crosses_splits' | 'scene_type_absent' | 'lighting_absent';
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
  const siteSplits = new Map<string, Set<CorpusSplit>>();

  for (const sequence of manifest.sequences) {
    splitCounts[sequence.split] += 1;
    increment(sceneTypeCounts, sequence.sceneType);
    increment(lightingCounts, sequence.lighting);
    increment(viewAngleCounts, sequence.viewAngle);
    const splits = siteSplits.get(sequence.siteId) ?? new Set<CorpusSplit>();
    splits.add(sequence.split);
    siteSplits.set(sequence.siteId, splits);
  }

  const sitesAcrossMultipleSplits = [...siteSplits.entries()]
    .filter(([, splits]) => splits.size > 1)
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
      message: `${sitesAcrossMultipleSplits.length} siteId(s) aparecen en más de un split. Esto puede ser deliberado, pero debe evaluarse como posible dependencia entre conjuntos.`,
    });
  }
  for (const sceneType of SCENE_TYPES) {
    if ((sceneTypeCounts[sceneType] ?? 0) === 0) {
      findings.push({
        severity: 'info', code: 'scene_type_absent',
        message: `No hay secuencias etiquetadas como ${sceneType}.`,
      });
    }
  }
  for (const lighting of LIGHTING) {
    if ((lightingCounts[lighting] ?? 0) === 0) {
      findings.push({
        severity: 'info', code: 'lighting_absent',
        message: `No hay secuencias con condición de iluminación ${lighting}.`,
      });
    }
  }

  return {
    sequenceCount: manifest.sequences.length,
    siteCount: siteSplits.size,
    splitCounts,
    sceneTypeCounts,
    lightingCounts,
    viewAngleCounts,
    sitesAcrossMultipleSplits,
    findings,
  };
}
