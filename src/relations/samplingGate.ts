import type { BoundingBox } from '../core/types';
import type { EdgeInferenceProfileName } from '../detection/runtimeProfile';
import type { RelationCandidate, RelationEndpoint } from './types';

export type RelationSamplingReason =
  | 'new_pair'
  | 'interval_elapsed'
  | 'geometry_changed'
  | 'priority_changed';

export interface RelationSamplingConfig {
  minIntervalMs: number;
  maxPairsPerEvaluation: number;
  geometryChangeThreshold: number;
  priorityDeltaThreshold: number;
  stalePairRetentionMs: number;
}

export interface RelationSamplingSelection {
  candidate: RelationCandidate;
  reason: RelationSamplingReason;
  pairKey: string;
  elapsedMs?: number;
  geometryChange?: number;
  priorityDelta?: number;
}

export interface RelationSamplingPlan {
  timestampMs: number;
  candidateCount: number;
  eligibleCount: number;
  selected: RelationSamplingSelection[];
  deferredCount: number;
  budgetDeferredCount: number;
}

interface PairEvaluationState {
  evaluatedAtMs: number;
  priority: number;
  subjectBox: BoundingBox;
  objectBox: BoundingBox;
  lastSeenMs: number;
}

const DEFAULT_CONFIG: RelationSamplingConfig = {
  minIntervalMs: 1_000,
  maxPairsPerEvaluation: 8,
  geometryChangeThreshold: 0.2,
  priorityDeltaThreshold: 0.2,
  stalePairRetentionMs: 30_000,
};

/**
 * Engineering starting points for experiments only.
 *
 * These values are not validated performance recommendations. They exist so
 * the eco/balanced/performance experiments can start from explicit,
 * reproducible hypotheses instead of hidden UI constants.
 */
export const RELATION_SAMPLING_PROFILE_HINTS: Record<
  EdgeInferenceProfileName,
  RelationSamplingConfig
> = {
  eco: {
    minIntervalMs: 2_000,
    maxPairsPerEvaluation: 4,
    geometryChangeThreshold: 0.25,
    priorityDeltaThreshold: 0.25,
    stalePairRetentionMs: 30_000,
  },
  balanced: {
    minIntervalMs: 1_000,
    maxPairsPerEvaluation: 8,
    geometryChangeThreshold: 0.2,
    priorityDeltaThreshold: 0.2,
    stalePairRetentionMs: 30_000,
  },
  performance: {
    minIntervalMs: 500,
    maxPairsPerEvaluation: 16,
    geometryChangeThreshold: 0.15,
    priorityDeltaThreshold: 0.15,
    stalePairRetentionMs: 30_000,
  },
};

function finiteNonNegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be finite and >= 0`);
  }
  return value;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be an integer >= 1`);
  }
  return value;
}

function cloneBox(box: BoundingBox): BoundingBox {
  return { ...box };
}

function cloneCandidate(candidate: RelationCandidate): RelationCandidate {
  return {
    ...candidate,
    subject: { ...candidate.subject, bbox: cloneBox(candidate.subject.bbox) },
    object: { ...candidate.object, bbox: cloneBox(candidate.object.bbox) },
  };
}

function endpointKey(endpoint: RelationEndpoint): string {
  return `${endpoint.kind}:${endpoint.id}`;
}

export function relationCandidatePairKey(candidate: RelationCandidate): string {
  return `${endpointKey(candidate.subject)}=>${endpointKey(candidate.object)}`;
}

function center(box: BoundingBox): { x: number; y: number } {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function diagonal(box: BoundingBox): number {
  return Math.max(1, Math.hypot(box.width, box.height));
}

function boxChange(previous: BoundingBox, current: BoundingBox): number {
  const a = center(previous);
  const b = center(current);
  const displacement = Math.hypot(a.x - b.x, a.y - b.y)
    / Math.max(diagonal(previous), diagonal(current));

  const previousArea = Math.max(1, previous.width * previous.height);
  const currentArea = Math.max(1, current.width * current.height);
  const areaRatio = Math.min(previousArea, currentArea) / Math.max(previousArea, currentArea);
  const sizeChange = 1 - areaRatio;

  return Math.max(displacement, sizeChange);
}

function candidateGeometryChange(
  state: PairEvaluationState,
  candidate: RelationCandidate,
): number {
  return Math.max(
    boxChange(state.subjectBox, candidate.subject.bbox),
    boxChange(state.objectBox, candidate.object.bbox),
  );
}

function validatedConfig(
  overrides: Partial<RelationSamplingConfig>,
): RelationSamplingConfig {
  const config = { ...DEFAULT_CONFIG, ...overrides };
  finiteNonNegative(config.minIntervalMs, 'minIntervalMs');
  positiveInteger(config.maxPairsPerEvaluation, 'maxPairsPerEvaluation');
  finiteNonNegative(config.geometryChangeThreshold, 'geometryChangeThreshold');
  finiteNonNegative(config.priorityDeltaThreshold, 'priorityDeltaThreshold');
  finiteNonNegative(config.stalePairRetentionMs, 'stalePairRetentionMs');
  return config;
}

/**
 * Schedules expensive relation inference without treating skipped frames as
 * negative semantic evidence.
 *
 * Planning is intentionally side-effect free with respect to evaluatedAtMs.
 * Call recordEvaluation() only after the provider actually completed. If
 * inference fails, the pair remains eligible to retry on the next frame.
 */
export class RelationSamplingGate {
  private readonly config: RelationSamplingConfig;
  private readonly states = new Map<string, PairEvaluationState>();

  constructor(overrides: Partial<RelationSamplingConfig> = {}) {
    this.config = validatedConfig(overrides);
  }

  reset(): void {
    this.states.clear();
  }

  plan(
    candidates: readonly RelationCandidate[],
    timestampMs: number,
  ): RelationSamplingPlan {
    if (!Number.isFinite(timestampMs)) throw new Error('timestampMs must be finite');
    this.prune(timestampMs);

    const uniqueCandidates = new Map<string, RelationCandidate>();
    for (const candidate of candidates) {
      if (!Number.isFinite(candidate.priority)) {
        throw new Error('relation candidate priority must be finite');
      }
      const key = relationCandidatePairKey(candidate);
      const previous = uniqueCandidates.get(key);
      if (!previous || candidate.priority > previous.priority) {
        uniqueCandidates.set(key, candidate);
      }
    }

    const eligible: RelationSamplingSelection[] = [];
    for (const [pairKey, candidate] of uniqueCandidates) {
      const state = this.states.get(pairKey);
      if (!state) {
        eligible.push({
          candidate: cloneCandidate(candidate),
          reason: 'new_pair',
          pairKey,
        });
        continue;
      }

      state.lastSeenMs = timestampMs;
      const elapsedMs = Math.max(0, timestampMs - state.evaluatedAtMs);
      const geometryChange = candidateGeometryChange(state, candidate);
      const priorityDelta = Math.abs(candidate.priority - state.priority);

      let reason: RelationSamplingReason | null = null;
      if (geometryChange >= this.config.geometryChangeThreshold) {
        reason = 'geometry_changed';
      } else if (priorityDelta >= this.config.priorityDeltaThreshold) {
        reason = 'priority_changed';
      } else if (elapsedMs >= this.config.minIntervalMs) {
        reason = 'interval_elapsed';
      }

      if (reason) {
        eligible.push({
          candidate: cloneCandidate(candidate),
          reason,
          pairKey,
          elapsedMs,
          geometryChange,
          priorityDelta,
        });
      }
    }

    eligible.sort((a, b) => {
      const priorityDifference = b.candidate.priority - a.candidate.priority;
      if (priorityDifference !== 0) return priorityDifference;
      return a.pairKey.localeCompare(b.pairKey);
    });

    const selected = eligible.slice(0, this.config.maxPairsPerEvaluation);
    return {
      timestampMs,
      candidateCount: uniqueCandidates.size,
      eligibleCount: eligible.length,
      selected,
      deferredCount: uniqueCandidates.size - selected.length,
      budgetDeferredCount: Math.max(0, eligible.length - selected.length),
    };
  }

  recordEvaluation(
    selected: readonly RelationSamplingSelection[] | readonly RelationCandidate[],
    timestampMs: number,
  ): void {
    if (!Number.isFinite(timestampMs)) throw new Error('timestampMs must be finite');

    for (const item of selected) {
      const candidate = 'candidate' in item ? item.candidate : item;
      const key = relationCandidatePairKey(candidate);
      this.states.set(key, {
        evaluatedAtMs: timestampMs,
        priority: candidate.priority,
        subjectBox: cloneBox(candidate.subject.bbox),
        objectBox: cloneBox(candidate.object.bbox),
        lastSeenMs: timestampMs,
      });
    }
    this.prune(timestampMs);
  }

  getTrackedPairCount(): number {
    return this.states.size;
  }

  private prune(timestampMs: number): void {
    for (const [key, state] of this.states) {
      if (timestampMs - state.lastSeenMs > this.config.stalePairRetentionMs) {
        this.states.delete(key);
      }
    }
  }
}

export function relationSamplingConfigForProfile(
  profile: EdgeInferenceProfileName,
): RelationSamplingConfig {
  return { ...RELATION_SAMPLING_PROFILE_HINTS[profile] };
}

export const RELATION_SAMPLING_DEFAULTS = { ...DEFAULT_CONFIG };
