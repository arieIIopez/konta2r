import type { EntityType } from '../core/types';
import type {
  RelationCandidate,
  RelationEndpoint,
  RelationCandidateReason,
} from './types';

export interface RelationCandidateGateConfig {
  maxNormalizedDistance: number;
  maxCandidates: number;
  allowTrackToTrack: boolean;
  allowTrackToStatic: boolean;
}

const DEFAULT_CONFIG: RelationCandidateGateConfig = {
  maxNormalizedDistance: 2.5,
  maxCandidates: 32,
  allowTrackToTrack: true,
  allowTrackToStatic: true,
};

const PERSON_LIKE: ReadonlySet<EntityType> = new Set([
  'pedestrian',
  'cyclist',
  'skater',
  'motorcyclist',
]);

function center(endpoint: RelationEndpoint): { x: number; y: number } {
  return {
    x: endpoint.bbox.x + endpoint.bbox.width / 2,
    y: endpoint.bbox.y + endpoint.bbox.height / 2,
  };
}

function diagonal(endpoint: RelationEndpoint): number {
  return Math.max(1, Math.hypot(endpoint.bbox.width, endpoint.bbox.height));
}

function normalizedDistance(a: RelationEndpoint, b: RelationEndpoint): number {
  const ac = center(a);
  const bc = center(b);
  return Math.hypot(ac.x - bc.x, ac.y - bc.y) / Math.max(diagonal(a), diagonal(b));
}

function isEligibleSubject(endpoint: RelationEndpoint): boolean {
  return endpoint.kind === 'track'
    && endpoint.entityType !== undefined
    && PERSON_LIKE.has(endpoint.entityType);
}

function pairReason(
  subject: RelationEndpoint,
  object: RelationEndpoint,
): RelationCandidateReason {
  if (
    subject.kind === 'track'
    && object.kind === 'track'
    && (
      subject.entityType === 'pedestrian'
      || object.entityType === 'cyclist'
      || object.entityType === 'motorcyclist'
      || object.entityType === 'skater'
    )
  ) {
    return 'modal_ambiguity';
  }
  return 'spatial_proximity';
}

/**
 * Lightweight pre-gate for expensive relation inference.
 *
 * It deliberately uses geometry only to decide which pairs deserve semantic
 * evaluation. Geometry is not interpreted as evidence that the relation itself
 * exists.
 */
export function selectRelationCandidates(
  endpoints: readonly RelationEndpoint[],
  overrides: Partial<RelationCandidateGateConfig> = {},
): RelationCandidate[] {
  const config = { ...DEFAULT_CONFIG, ...overrides };
  if (!(config.maxNormalizedDistance > 0)) {
    throw new Error('maxNormalizedDistance must be greater than zero');
  }
  if (!Number.isInteger(config.maxCandidates) || config.maxCandidates < 1) {
    throw new Error('maxCandidates must be an integer >= 1');
  }

  const candidates: RelationCandidate[] = [];

  for (const subject of endpoints) {
    if (!isEligibleSubject(subject)) continue;

    for (const object of endpoints) {
      if (subject.id === object.id) continue;
      if (object.kind === 'track' && !config.allowTrackToTrack) continue;
      if (object.kind === 'static_element' && !config.allowTrackToStatic) continue;

      const distance = normalizedDistance(subject, object);
      if (distance > config.maxNormalizedDistance) continue;

      const proximity = Math.max(0, 1 - distance / config.maxNormalizedDistance);
      const confidence = subject.confidence === undefined
        ? 1
        : Math.max(0, Math.min(1, subject.confidence));
      const priority = 0.75 * proximity + 0.25 * confidence;

      candidates.push({
        subject: { ...subject, bbox: { ...subject.bbox } },
        object: { ...object, bbox: { ...object.bbox } },
        priority,
        reason: pairReason(subject, object),
      });
    }
  }

  return candidates
    .sort((a, b) => b.priority - a.priority)
    .slice(0, config.maxCandidates);
}

export const RELATION_CANDIDATE_GATE_DEFAULTS = { ...DEFAULT_CONFIG };
