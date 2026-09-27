import type { BoundingBox } from '../core/types';

export type PublicLifeGroundTruthEndpointKind =
  | 'tracked_entity'
  | 'semantic_element';

export type PublicLifeGroundTruthEntityType =
  | 'person'
  | 'bicycle'
  | 'motorcycle'
  | 'skateboard'
  | 'mobility_object'
  | 'other';

export type PublicLifeEndpointVisibility =
  | 'visible'
  | 'partial'
  | 'heavy'
  | 'not_observable';

export type PublicLifeRelationJudgmentLabel =
  | 'positive'
  | 'negative'
  | 'uncertain'
  | 'not_observable';

export interface PublicLifeGroundTruthEndpoint {
  endpointId: string;
  kind: PublicLifeGroundTruthEndpointKind;
  entityType?: PublicLifeGroundTruthEntityType;
  semanticElementId?: string;
}

export interface PublicLifeEndpointObservation {
  endpointId: string;
  visibility: PublicLifeEndpointVisibility;
  bbox?: BoundingBox;
}

export interface PublicLifeRelationJudgment {
  subjectId: string;
  objectId: string;
  predicateId: string;
  label: PublicLifeRelationJudgmentLabel;
  note?: string;
}

export interface PublicLifeGroundTruthFrame {
  frameId: string;
  timestampMs: number;
  width: number;
  height: number;
  endpoints: PublicLifeEndpointObservation[];
  judgments: PublicLifeRelationJudgment[];
}

export type PublicLifeEpisodeLabel = 'positive' | 'uncertain';

export interface PublicLifeGroundTruthEpisode {
  episodeId: string;
  subjectId: string;
  objectId: string;
  predicateId: string;
  startMs: number;
  endMs: number;
  label: PublicLifeEpisodeLabel;
  note?: string;
}

export interface PublicLifeGroundTruthSequence {
  schemaVersion: '1';
  sequenceId: string;
  annotationProtocolVersion: string;
  vocabularyId: string;
  durationMs: number;
  targetPredicateIds: string[];
  endpoints: PublicLifeGroundTruthEndpoint[];
  frames: PublicLifeGroundTruthFrame[];
  episodes: PublicLifeGroundTruthEpisode[];
  note?: string;
}

const ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const PREDICATE_ID = /^[a-z][a-z0-9_]{0,63}$/;

function nonEmpty(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error(`${label} is required`);
  return normalized;
}

function validateId(value: string, label: string): string {
  const normalized = nonEmpty(value, label);
  if (!ID.test(normalized)) {
    throw new Error(`${label} must be a 1-128 character opaque identifier`);
  }
  return normalized;
}

function positiveFinite(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be finite and > 0`);
  }
  return value;
}

function finiteNonNegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be finite and >= 0`);
  }
  return value;
}

function validateOptionalText(
  value: string | undefined,
  label: string,
  maxLength: number,
): void {
  if (value === undefined) return;
  if (nonEmpty(value, label).length > maxLength) {
    throw new Error(`${label} must be ${maxLength} characters or fewer`);
  }
}

function validateBbox(
  bbox: BoundingBox,
  width: number,
  height: number,
  label: string,
): void {
  if (![bbox.x, bbox.y, bbox.width, bbox.height].every(Number.isFinite)) {
    throw new Error(`${label} must contain finite coordinates`);
  }
  if (!(bbox.width > 0) || !(bbox.height > 0)) {
    throw new Error(`${label} width and height must be > 0`);
  }
  if (
    bbox.x + bbox.width <= 0
    || bbox.y + bbox.height <= 0
    || bbox.x >= width
    || bbox.y >= height
  ) {
    throw new Error(`${label} does not intersect the frame`);
  }
}

function judgmentKey(judgment: PublicLifeRelationJudgment): string {
  return JSON.stringify([
    judgment.subjectId,
    judgment.predicateId,
    judgment.objectId,
  ]);
}

function episodeKey(episode: PublicLifeGroundTruthEpisode): string {
  return JSON.stringify([
    episode.subjectId,
    episode.predicateId,
    episode.objectId,
    episode.startMs,
    episode.endMs,
  ]);
}

function targetPredicateSet(ids: readonly string[]): Set<string> {
  if (ids.length === 0) throw new Error('targetPredicateIds must contain at least one predicate');
  const set = new Set<string>();
  for (const raw of ids) {
    const id = nonEmpty(raw, 'targetPredicateId');
    if (!PREDICATE_ID.test(id)) {
      throw new Error(`Invalid target predicate id ${id}`);
    }
    if (set.has(id)) throw new Error(`Duplicate target predicate id ${id}`);
    set.add(id);
  }
  return set;
}

export function validatePublicLifeGroundTruthSequence(
  sequence: PublicLifeGroundTruthSequence,
): void {
  if (sequence.schemaVersion !== '1') {
    throw new Error('Unsupported Public Life ground-truth schemaVersion');
  }
  validateId(sequence.sequenceId, 'sequenceId');
  nonEmpty(sequence.annotationProtocolVersion, 'annotationProtocolVersion');
  nonEmpty(sequence.vocabularyId, 'vocabularyId');
  positiveFinite(sequence.durationMs, 'durationMs');
  validateOptionalText(sequence.note, 'sequence note', 2_000);

  const predicates = targetPredicateSet(sequence.targetPredicateIds);
  const endpoints = new Map<string, PublicLifeGroundTruthEndpoint>();
  for (const endpoint of sequence.endpoints) {
    const endpointId = validateId(endpoint.endpointId, 'endpointId');
    if (endpoints.has(endpointId)) throw new Error(`Duplicate endpointId ${endpointId}`);

    if (endpoint.kind === 'tracked_entity') {
      if (endpoint.entityType === undefined) {
        throw new Error(`Tracked endpoint ${endpointId} requires entityType`);
      }
      if (endpoint.semanticElementId !== undefined) {
        throw new Error(`Tracked endpoint ${endpointId} cannot declare semanticElementId`);
      }
    } else {
      if (endpoint.semanticElementId === undefined) {
        throw new Error(`Semantic endpoint ${endpointId} requires semanticElementId`);
      }
      validateId(endpoint.semanticElementId, `endpoint ${endpointId} semanticElementId`);
      if (endpoint.entityType !== undefined) {
        throw new Error(`Semantic endpoint ${endpointId} cannot declare entityType`);
      }
    }

    endpoints.set(endpointId, endpoint);
  }
  if (endpoints.size === 0) throw new Error('Ground truth must define at least one endpoint');

  const frameIds = new Set<string>();
  let previousTimestampMs = Number.NEGATIVE_INFINITY;

  for (const frame of sequence.frames) {
    const frameId = validateId(frame.frameId, 'frameId');
    if (frameIds.has(frameId)) throw new Error(`Duplicate frameId ${frameId}`);
    frameIds.add(frameId);
    positiveFinite(frame.width, `frame ${frameId} width`);
    positiveFinite(frame.height, `frame ${frameId} height`);
    finiteNonNegative(frame.timestampMs, `frame ${frameId} timestampMs`);
    if (frame.timestampMs > sequence.durationMs) {
      throw new Error(`Frame ${frameId} exceeds sequence duration`);
    }
    if (frame.timestampMs < previousTimestampMs) {
      throw new Error('Public Life frame timestamps must be non-decreasing');
    }
    previousTimestampMs = frame.timestampMs;

    const observations = new Map<string, PublicLifeEndpointObservation>();
    for (const observation of frame.endpoints) {
      const endpointId = validateId(observation.endpointId, `frame ${frameId} endpointId`);
      if (!endpoints.has(endpointId)) {
        throw new Error(`Frame ${frameId} references unknown endpoint ${endpointId}`);
      }
      if (observations.has(endpointId)) {
        throw new Error(`Frame ${frameId} duplicates endpoint observation ${endpointId}`);
      }

      if (observation.visibility === 'not_observable') {
        if (observation.bbox !== undefined) {
          throw new Error(
            `Frame ${frameId} endpoint ${endpointId} cannot have bbox when not_observable`,
          );
        }
      } else {
        if (observation.bbox === undefined) {
          throw new Error(
            `Frame ${frameId} endpoint ${endpointId} requires bbox when observable`,
          );
        }
        validateBbox(
          observation.bbox,
          frame.width,
          frame.height,
          `frame ${frameId} endpoint ${endpointId} bbox`,
        );
      }

      observations.set(endpointId, observation);
    }

    const judgmentKeys = new Set<string>();
    for (const judgment of frame.judgments) {
      if (!predicates.has(judgment.predicateId)) {
        throw new Error(
          `Frame ${frameId} judgment uses non-target predicate ${judgment.predicateId}`,
        );
      }
      if (judgment.subjectId === judgment.objectId) {
        throw new Error(`Frame ${frameId} relation cannot use the same endpoint twice`);
      }
      const subject = observations.get(judgment.subjectId);
      const object = observations.get(judgment.objectId);
      if (!subject || !object) {
        throw new Error(
          `Frame ${frameId} judgment endpoints must both have frame observations`,
        );
      }

      const key = judgmentKey(judgment);
      if (judgmentKeys.has(key)) {
        throw new Error(`Frame ${frameId} contains duplicate relation judgment`);
      }
      judgmentKeys.add(key);
      validateOptionalText(judgment.note, `frame ${frameId} judgment note`, 500);

      const notObservable = subject.visibility === 'not_observable'
        || object.visibility === 'not_observable';
      if (notObservable && judgment.label !== 'not_observable') {
        throw new Error(
          `Frame ${frameId} must label relation not_observable when an endpoint is not observable`,
        );
      }
      if (!notObservable && judgment.label === 'not_observable') {
        throw new Error(
          `Frame ${frameId} cannot label relation not_observable when both endpoints are observable`,
        );
      }
    }
  }

  const episodeIds = new Set<string>();
  const episodeKeys = new Set<string>();
  for (const episode of sequence.episodes) {
    const episodeId = validateId(episode.episodeId, 'episodeId');
    if (episodeIds.has(episodeId)) throw new Error(`Duplicate episodeId ${episodeId}`);
    episodeIds.add(episodeId);
    if (!endpoints.has(episode.subjectId) || !endpoints.has(episode.objectId)) {
      throw new Error(`Episode ${episodeId} references unknown endpoint`);
    }
    if (episode.subjectId === episode.objectId) {
      throw new Error(`Episode ${episodeId} cannot use the same endpoint twice`);
    }
    if (!predicates.has(episode.predicateId)) {
      throw new Error(`Episode ${episodeId} uses non-target predicate ${episode.predicateId}`);
    }
    finiteNonNegative(episode.startMs, `episode ${episodeId} startMs`);
    finiteNonNegative(episode.endMs, `episode ${episodeId} endMs`);
    if (!(episode.endMs > episode.startMs)) {
      throw new Error(`Episode ${episodeId} endMs must be greater than startMs`);
    }
    if (episode.endMs > sequence.durationMs) {
      throw new Error(`Episode ${episodeId} exceeds sequence duration`);
    }
    validateOptionalText(episode.note, `episode ${episodeId} note`, 500);

    const key = episodeKey(episode);
    if (episodeKeys.has(key)) throw new Error(`Duplicate Public Life episode ${episodeId}`);
    episodeKeys.add(key);
  }
}

export interface PublicLifeGroundTruthSummary {
  frameCount: number;
  endpointCount: number;
  episodeCount: number;
  judgmentCounts: Record<string, Record<PublicLifeRelationJudgmentLabel, number>>;
  episodeCounts: Record<string, Record<PublicLifeEpisodeLabel, number>>;
  positiveEpisodeDurationMs: Record<string, number>;
  unjudgedTargetPredicates: string[];
  predicatesWithoutPositiveFrames: string[];
  predicatesWithoutNegativeFrames: string[];
}

function ensureJudgmentCounter(
  record: Record<string, Record<PublicLifeRelationJudgmentLabel, number>>,
  predicateId: string,
): Record<PublicLifeRelationJudgmentLabel, number> {
  return record[predicateId] ??= {
    positive: 0,
    negative: 0,
    uncertain: 0,
    not_observable: 0,
  };
}

function ensureEpisodeCounter(
  record: Record<string, Record<PublicLifeEpisodeLabel, number>>,
  predicateId: string,
): Record<PublicLifeEpisodeLabel, number> {
  return record[predicateId] ??= { positive: 0, uncertain: 0 };
}

export function summarizePublicLifeGroundTruth(
  sequence: PublicLifeGroundTruthSequence,
): PublicLifeGroundTruthSummary {
  validatePublicLifeGroundTruthSequence(sequence);

  const judgmentCounts: PublicLifeGroundTruthSummary['judgmentCounts'] = {};
  const episodeCounts: PublicLifeGroundTruthSummary['episodeCounts'] = {};
  const positiveEpisodeDurationMs: Record<string, number> = {};

  for (const predicateId of sequence.targetPredicateIds) {
    ensureJudgmentCounter(judgmentCounts, predicateId);
    ensureEpisodeCounter(episodeCounts, predicateId);
    positiveEpisodeDurationMs[predicateId] = 0;
  }

  for (const frame of sequence.frames) {
    for (const judgment of frame.judgments) {
      ensureJudgmentCounter(judgmentCounts, judgment.predicateId)[judgment.label] += 1;
    }
  }

  for (const episode of sequence.episodes) {
    ensureEpisodeCounter(episodeCounts, episode.predicateId)[episode.label] += 1;
    if (episode.label === 'positive') {
      positiveEpisodeDurationMs[episode.predicateId] =
        (positiveEpisodeDurationMs[episode.predicateId] ?? 0)
        + (episode.endMs - episode.startMs);
    }
  }

  const unjudgedTargetPredicates = sequence.targetPredicateIds
    .filter((predicateId) => {
      const counts = judgmentCounts[predicateId];
      return counts
        && counts.positive + counts.negative + counts.uncertain + counts.not_observable === 0;
    })
    .sort();

  const predicatesWithoutPositiveFrames = sequence.targetPredicateIds
    .filter((predicateId) => (judgmentCounts[predicateId]?.positive ?? 0) === 0)
    .sort();

  const predicatesWithoutNegativeFrames = sequence.targetPredicateIds
    .filter((predicateId) => (judgmentCounts[predicateId]?.negative ?? 0) === 0)
    .sort();

  return {
    frameCount: sequence.frames.length,
    endpointCount: sequence.endpoints.length,
    episodeCount: sequence.episodes.length,
    judgmentCounts,
    episodeCounts,
    positiveEpisodeDurationMs,
    unjudgedTargetPredicates,
    predicatesWithoutPositiveFrames,
    predicatesWithoutNegativeFrames,
  };
}
