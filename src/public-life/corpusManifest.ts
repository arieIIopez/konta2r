import {
  CORPUS_LIGHTING,
  CORPUS_SPLITS,
  CORPUS_VIEW_ANGLES,
  type CorpusLighting,
  type CorpusSplit,
  type CorpusViewAngle,
} from '../detection/corpusManifest';

export type PublicLifeSpaceType =
  | 'plaza'
  | 'park'
  | 'sidewalk'
  | 'pedestrian_street'
  | 'transit_stop'
  | 'commercial_frontage'
  | 'school_frontage'
  | 'cycleway_edge'
  | 'shared_space'
  | 'other';

export type PublicLifeDensity = 'low' | 'medium' | 'high' | 'mixed';
export type PublicLifeOcclusion = 'low' | 'medium' | 'high' | 'mixed';
export type PublicLifeCameraStability = 'fixed' | 'minor_motion' | 'mobile';
export type PublicLifeGroundTruthMethod =
  | 'single_annotator'
  | 'independent_double'
  | 'consensus'
  | 'synthetic';

export interface PublicLifeCorpusSequence {
  sequenceId: string;
  annotationSha256: string;
  mediaSha256?: string;
  semanticMapSha256?: string;
  split: CorpusSplit;
  siteId: string;
  spaceType: PublicLifeSpaceType;
  lighting: CorpusLighting;
  viewAngle: CorpusViewAngle;
  density: PublicLifeDensity;
  occlusion: PublicLifeOcclusion;
  cameraStability: PublicLifeCameraStability;
  groundTruthMethod: PublicLifeGroundTruthMethod;
  durationMs: number;
  targetPredicateIds: string[];
  positiveEpisodeCounts?: Record<string, number>;
  uncertainEpisodeCount?: number;
  tags?: string[];
  note?: string;
}

export interface PublicLifeCorpusManifest {
  schemaVersion: '1';
  corpusId: string;
  createdAtIso: string;
  annotationProtocolVersion: string;
  vocabularyId: string;
  vocabularySha256: string;
  sequences: PublicLifeCorpusSequence[];
  note?: string;
}

export const PUBLIC_LIFE_SPACE_TYPES: readonly PublicLifeSpaceType[] = [
  'plaza', 'park', 'sidewalk', 'pedestrian_street', 'transit_stop',
  'commercial_frontage', 'school_frontage', 'cycleway_edge', 'shared_space', 'other',
];
export const PUBLIC_LIFE_DENSITIES: readonly PublicLifeDensity[] = ['low', 'medium', 'high', 'mixed'];
export const PUBLIC_LIFE_OCCLUSIONS: readonly PublicLifeOcclusion[] = ['low', 'medium', 'high', 'mixed'];
export const PUBLIC_LIFE_CAMERA_STABILITIES: readonly PublicLifeCameraStability[] = ['fixed', 'minor_motion', 'mobile'];
export const PUBLIC_LIFE_GROUND_TRUTH_METHODS: readonly PublicLifeGroundTruthMethod[] = [
  'single_annotator', 'independent_double', 'consensus', 'synthetic',
];

const SHA256 = /^[a-f0-9]{64}$/i;
const OPAQUE_SITE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
const PREDICATE_ID = /^[a-z][a-z0-9_]{0,63}$/;

function nonEmpty(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error(`${label} is required`);
  return normalized;
}

function hash(value: string, label: string): string {
  const normalized = nonEmpty(value, label).toLowerCase();
  if (!SHA256.test(normalized)) throw new Error(`${label} must be a SHA-256 hex digest`);
  return normalized;
}

function positiveFinite(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be finite and > 0`);
  return value;
}

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be an integer >= 0`);
  return value;
}

function validateSiteId(value: string): string {
  const siteId = nonEmpty(value, 'siteId');
  if (!OPAQUE_SITE_ID.test(siteId)) {
    throw new Error('siteId must be an opaque 1-64 character token');
  }
  const coordinateLike = siteId.match(/-?\d{1,3}\.\d{4,}/g);
  if ((coordinateLike?.length ?? 0) >= 2) {
    throw new Error('siteId must not encode precise latitude/longitude coordinates');
  }
  return siteId;
}

function validatePredicateIds(ids: readonly string[], label: string): string[] {
  if (ids.length === 0) throw new Error(`${label} must contain at least one predicate id`);
  const seen = new Set<string>();
  return ids.map((raw, index) => {
    const id = nonEmpty(raw, `${label}[${index}]`);
    if (!PREDICATE_ID.test(id)) throw new Error(`${label} contains invalid predicate id ${id}`);
    if (seen.has(id)) throw new Error(`${label} contains duplicate predicate id ${id}`);
    seen.add(id);
    return id;
  });
}

function optionalText(value: string | undefined, label: string, maxLength: number): void {
  if (value === undefined) return;
  if (nonEmpty(value, label).length > maxLength) {
    throw new Error(`${label} must be ${maxLength} characters or fewer`);
  }
}

export function validatePublicLifeCorpusManifest(manifest: PublicLifeCorpusManifest): void {
  if (manifest.schemaVersion !== '1') throw new Error('Unsupported Public Life corpus schemaVersion');
  nonEmpty(manifest.corpusId, 'corpusId');
  nonEmpty(manifest.annotationProtocolVersion, 'annotationProtocolVersion');
  nonEmpty(manifest.vocabularyId, 'vocabularyId');
  hash(manifest.vocabularySha256, 'vocabularySha256');
  if (Number.isNaN(Date.parse(manifest.createdAtIso))) throw new Error('createdAtIso must be a valid ISO date');
  if (manifest.sequences.length === 0) throw new Error('Public Life corpus must contain at least one sequence');
  optionalText(manifest.note, 'manifest note', 2_000);

  const sequenceIds = new Set<string>();
  const mediaSplits = new Map<string, CorpusSplit>();
  const annotationSplits = new Map<string, CorpusSplit>();

  for (const sequence of manifest.sequences) {
    const sequenceId = nonEmpty(sequence.sequenceId, 'sequenceId');
    if (sequenceIds.has(sequenceId)) throw new Error(`Duplicate sequenceId ${sequenceId}`);
    sequenceIds.add(sequenceId);

    const annotationSha = hash(sequence.annotationSha256, `sequence ${sequenceId} annotationSha256`);
    const mediaSha = sequence.mediaSha256 === undefined
      ? undefined
      : hash(sequence.mediaSha256, `sequence ${sequenceId} mediaSha256`);
    if (sequence.semanticMapSha256 !== undefined) {
      hash(sequence.semanticMapSha256, `sequence ${sequenceId} semanticMapSha256`);
    }

    validateSiteId(sequence.siteId);
    if (!CORPUS_SPLITS.includes(sequence.split)) throw new Error(`Unsupported split ${sequence.split}`);
    if (!PUBLIC_LIFE_SPACE_TYPES.includes(sequence.spaceType)) throw new Error(`Unsupported spaceType ${sequence.spaceType}`);
    if (!CORPUS_LIGHTING.includes(sequence.lighting)) throw new Error(`Unsupported lighting ${sequence.lighting}`);
    if (!CORPUS_VIEW_ANGLES.includes(sequence.viewAngle)) throw new Error(`Unsupported viewAngle ${sequence.viewAngle}`);
    if (!PUBLIC_LIFE_DENSITIES.includes(sequence.density)) throw new Error(`Unsupported density ${sequence.density}`);
    if (!PUBLIC_LIFE_OCCLUSIONS.includes(sequence.occlusion)) throw new Error(`Unsupported occlusion ${sequence.occlusion}`);
    if (!PUBLIC_LIFE_CAMERA_STABILITIES.includes(sequence.cameraStability)) {
      throw new Error(`Unsupported cameraStability ${sequence.cameraStability}`);
    }
    if (!PUBLIC_LIFE_GROUND_TRUTH_METHODS.includes(sequence.groundTruthMethod)) {
      throw new Error(`Unsupported groundTruthMethod ${sequence.groundTruthMethod}`);
    }
    positiveFinite(sequence.durationMs, `sequence ${sequenceId} durationMs`);
    const targetIds = new Set(validatePredicateIds(sequence.targetPredicateIds, `sequence ${sequenceId} targetPredicateIds`));

    if (sequence.positiveEpisodeCounts) {
      for (const [predicateId, count] of Object.entries(sequence.positiveEpisodeCounts)) {
        if (!targetIds.has(predicateId)) {
          throw new Error(`positiveEpisodeCounts contains non-target predicate ${predicateId} in ${sequenceId}`);
        }
        nonNegativeInteger(count, `positiveEpisodeCounts.${predicateId}`);
      }
    }
    if (sequence.uncertainEpisodeCount !== undefined) {
      nonNegativeInteger(sequence.uncertainEpisodeCount, `sequence ${sequenceId} uncertainEpisodeCount`);
    }
    optionalText(sequence.note, `sequence ${sequenceId} note`, 1_000);

    const priorAnnotationSplit = annotationSplits.get(annotationSha);
    if (priorAnnotationSplit !== undefined && priorAnnotationSplit !== sequence.split) {
      throw new Error(`Annotation file is reused across Public Life corpus splits: ${sequenceId}`);
    }
    annotationSplits.set(annotationSha, sequence.split);

    if (mediaSha !== undefined) {
      const priorMediaSplit = mediaSplits.get(mediaSha);
      if (priorMediaSplit !== undefined && priorMediaSplit !== sequence.split) {
        throw new Error(`Media file is reused across Public Life corpus splits: ${sequenceId}`);
      }
      mediaSplits.set(mediaSha, sequence.split);
    }

    if (sequence.tags) {
      const tags = new Set<string>();
      for (const raw of sequence.tags) {
        const tag = nonEmpty(raw, `sequence ${sequenceId} tag`);
        if (tag.length > 80) throw new Error(`Tag ${tag} in ${sequenceId} is longer than 80 characters`);
        if (tags.has(tag)) throw new Error(`Duplicate tag ${tag} in ${sequenceId}`);
        tags.add(tag);
      }
    }
  }
}

export interface PublicLifeCorpusCoverage {
  sequenceCount: number;
  siteCount: number;
  totalDurationMs: number;
  splitCounts: Record<CorpusSplit, number>;
  spaceTypeCounts: Partial<Record<PublicLifeSpaceType, number>>;
  densityCounts: Partial<Record<PublicLifeDensity, number>>;
  occlusionCounts: Partial<Record<PublicLifeOcclusion, number>>;
  groundTruthMethodCounts: Partial<Record<PublicLifeGroundTruthMethod, number>>;
  targetPredicateSequenceCounts: Record<string, number>;
  positiveEpisodeCounts: Record<string, number>;
  heldOutSitesSeenElsewhere: string[];
  findings: Array<{
    severity: 'info' | 'warning';
    code:
      | 'missing_held_out_test'
      | 'single_site'
      | 'held_out_site_seen_elsewhere'
      | 'predicate_without_positive_episode'
      | 'held_out_without_independent_ground_truth'
      | 'space_type_absent'
      | 'density_absent'
      | 'occlusion_absent';
    message: string;
  }>;
}

function increment<T extends string>(record: Partial<Record<T, number>>, key: T): void {
  record[key] = (record[key] ?? 0) + 1;
}

export function summarizePublicLifeCorpusCoverage(
  manifest: PublicLifeCorpusManifest,
): PublicLifeCorpusCoverage {
  validatePublicLifeCorpusManifest(manifest);
  const splitCounts: Record<CorpusSplit, number> = { development: 0, validation: 0, held_out_test: 0 };
  const spaceTypeCounts: Partial<Record<PublicLifeSpaceType, number>> = {};
  const densityCounts: Partial<Record<PublicLifeDensity, number>> = {};
  const occlusionCounts: Partial<Record<PublicLifeOcclusion, number>> = {};
  const groundTruthMethodCounts: Partial<Record<PublicLifeGroundTruthMethod, number>> = {};
  const targetPredicateSequenceCounts: Record<string, number> = {};
  const positiveEpisodeCounts: Record<string, number> = {};
  const siteSplits = new Map<string, Set<CorpusSplit>>();
  let totalDurationMs = 0;

  for (const sequence of manifest.sequences) {
    splitCounts[sequence.split] += 1;
    totalDurationMs += sequence.durationMs;
    increment(spaceTypeCounts, sequence.spaceType);
    increment(densityCounts, sequence.density);
    increment(occlusionCounts, sequence.occlusion);
    increment(groundTruthMethodCounts, sequence.groundTruthMethod);

    const splits = siteSplits.get(sequence.siteId) ?? new Set<CorpusSplit>();
    splits.add(sequence.split);
    siteSplits.set(sequence.siteId, splits);

    for (const predicateId of sequence.targetPredicateIds) {
      targetPredicateSequenceCounts[predicateId] = (targetPredicateSequenceCounts[predicateId] ?? 0) + 1;
    }
    for (const [predicateId, count] of Object.entries(sequence.positiveEpisodeCounts ?? {})) {
      positiveEpisodeCounts[predicateId] = (positiveEpisodeCounts[predicateId] ?? 0) + count;
    }
  }

  const heldOutSitesSeenElsewhere = [...siteSplits.entries()]
    .filter(([, splits]) =>
      splits.has('held_out_test') && (splits.has('development') || splits.has('validation')))
    .map(([siteId]) => siteId)
    .sort();

  const findings: PublicLifeCorpusCoverage['findings'] = [];
  if (splitCounts.held_out_test === 0) {
    findings.push({
      severity: 'warning',
      code: 'missing_held_out_test',
      message: 'No hay secuencias held_out_test reservadas para evaluación final.',
    });
  }
  if (siteSplits.size < 2) {
    findings.push({
      severity: 'warning',
      code: 'single_site',
      message: 'El corpus sólo contiene un siteId y no describe variación entre espacios públicos.',
    });
  }
  if (heldOutSitesSeenElsewhere.length > 0) {
    findings.push({
      severity: 'warning',
      code: 'held_out_site_seen_elsewhere',
      message: `${heldOutSitesSeenElsewhere.length} siteId(s) del held_out_test aparecen también en desarrollo/validación.`,
    });
  }

  const allPredicates = Object.keys(targetPredicateSequenceCounts).sort();
  for (const predicateId of allPredicates) {
    if ((positiveEpisodeCounts[predicateId] ?? 0) === 0) {
      findings.push({
        severity: 'warning',
        code: 'predicate_without_positive_episode',
        message: `El predicado ${predicateId} está en el alcance de anotación pero no tiene episodios positivos declarados.`,
      });
    }
  }

  const heldOut = manifest.sequences.filter((sequence) => sequence.split === 'held_out_test');
  if (
    heldOut.length > 0
    && heldOut.some((sequence) =>
      sequence.groundTruthMethod !== 'independent_double'
      && sequence.groundTruthMethod !== 'consensus')
  ) {
    findings.push({
      severity: 'warning',
      code: 'held_out_without_independent_ground_truth',
      message: 'Parte del held_out_test no usa doble anotación independiente ni consenso.',
    });
  }

  for (const spaceType of PUBLIC_LIFE_SPACE_TYPES) {
    if ((spaceTypeCounts[spaceType] ?? 0) === 0) {
      findings.push({ severity: 'info', code: 'space_type_absent', message: `No hay secuencias ${spaceType}.` });
    }
  }
  for (const density of PUBLIC_LIFE_DENSITIES) {
    if ((densityCounts[density] ?? 0) === 0) {
      findings.push({ severity: 'info', code: 'density_absent', message: `No hay secuencias de densidad ${density}.` });
    }
  }
  for (const occlusion of PUBLIC_LIFE_OCCLUSIONS) {
    if ((occlusionCounts[occlusion] ?? 0) === 0) {
      findings.push({ severity: 'info', code: 'occlusion_absent', message: `No hay secuencias con oclusión ${occlusion}.` });
    }
  }

  return {
    sequenceCount: manifest.sequences.length,
    siteCount: siteSplits.size,
    totalDurationMs,
    splitCounts,
    spaceTypeCounts,
    densityCounts,
    occlusionCounts,
    groundTruthMethodCounts,
    targetPredicateSequenceCounts,
    positiveEpisodeCounts,
    heldOutSitesSeenElsewhere,
    findings,
  };
}
