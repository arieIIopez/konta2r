import type {
  ActivityEpisode,
  RelationEndpointKind,
  RelationFrameState,
} from './types';

export interface RelationTemporalPersistenceConfig {
  openThreshold: number;
  closeThreshold: number;
  minOpenSamples: number;
  scoreSmoothing: number;
  maxUnobservableMs: number;
}

export interface ActiveRelationState {
  subjectId: string;
  subjectKind: RelationEndpointKind;
  objectId: string;
  objectKind: RelationEndpointKind;
  predicate: string;
  startMs: number;
  lastEvaluatedMs: number;
  smoothedScore: number;
  sourceObservationCount: number;
}

export interface RelationTemporalUpdate {
  activeRelations: ActiveRelationState[];
  completedEpisodes: ActivityEpisode[];
}

interface InternalRelationState {
  subjectId: string;
  subjectKind: RelationEndpointKind;
  objectId: string;
  objectKind: RelationEndpointKind;
  predicate: string;
  smoothedScore: number | null;
  lastEvaluatedMs: number | null;
  unobservableSinceMs: number | null;
  positiveStreak: number;
  firstPositiveMs: number | null;
  openingScoreSum: number;
  openingObservationCount: number;
  active: boolean;
  startMs: number | null;
  scoreSum: number;
  sourceObservationCount: number;
}

const DEFAULT_CONFIG: RelationTemporalPersistenceConfig = {
  openThreshold: 0.65,
  closeThreshold: 0.35,
  minOpenSamples: 2,
  scoreSmoothing: 0.55,
  maxUnobservableMs: 1500,
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function relationKey(state: Pick<
  RelationFrameState,
  'subjectId' | 'objectId' | 'predicate'
>): string {
  return JSON.stringify([state.subjectId, state.predicate, state.objectId]);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/**
 * Converts noisy frame-level relation scores into auditable temporal episodes.
 *
 * Missing evaluation is not negative evidence. The caller must explicitly
 * report endpoint/provider unavailability; only then can an active relation
 * expire after maxUnobservableMs.
 */
export class RelationTemporalPersistence {
  private readonly config: RelationTemporalPersistenceConfig;
  private readonly sessionId: string;
  private readonly states = new Map<string, InternalRelationState>();
  private nextEpisodeNumber = 1;

  constructor(
    sessionId: string,
    overrides: Partial<RelationTemporalPersistenceConfig> = {},
  ) {
    if (sessionId.trim().length === 0) throw new Error('sessionId is required');
    this.sessionId = sessionId;
    this.config = { ...DEFAULT_CONFIG, ...overrides };

    if (
      this.config.closeThreshold < 0
      || this.config.openThreshold > 1
      || this.config.closeThreshold >= this.config.openThreshold
    ) {
      throw new Error('relation thresholds must satisfy 0 <= close < open <= 1');
    }
    if (!Number.isInteger(this.config.minOpenSamples) || this.config.minOpenSamples < 1) {
      throw new Error('minOpenSamples must be an integer >= 1');
    }
    if (this.config.scoreSmoothing < 0 || this.config.scoreSmoothing > 1) {
      throw new Error('scoreSmoothing must be within [0, 1]');
    }
    if (!(this.config.maxUnobservableMs >= 0)) {
      throw new Error('maxUnobservableMs must be >= 0');
    }
  }

  reset(): void {
    this.states.clear();
    this.nextEpisodeNumber = 1;
  }

  update(
    frameStates: readonly RelationFrameState[],
    timestampMs: number,
  ): RelationTemporalUpdate {
    if (!Number.isFinite(timestampMs)) throw new Error('timestampMs must be finite');

    const completedEpisodes: ActivityEpisode[] = [];

    for (const frame of frameStates) {
      if (!Number.isFinite(frame.timestampMs)) {
        throw new Error('relation frame timestampMs must be finite');
      }
      if (frame.timestampMs > timestampMs) {
        throw new Error('relation frame timestamp cannot be in the future of update timestamp');
      }

      const key = relationKey(frame);
      const state = this.states.get(key) ?? this.createState(frame);
      this.assertEndpointStability(state, frame);
      this.states.set(key, state);

      if (frame.evaluability !== 'evaluated') {
        state.unobservableSinceMs ??= frame.timestampMs;
        continue;
      }

      if (frame.score === undefined || !Number.isFinite(frame.score)) {
        throw new Error('evaluated relation frame requires a finite score');
      }

      const score = clamp01(frame.score);
      state.unobservableSinceMs = null;
      state.lastEvaluatedMs = frame.timestampMs;
      state.smoothedScore = state.smoothedScore === null
        ? score
        : this.config.scoreSmoothing * score
          + (1 - this.config.scoreSmoothing) * state.smoothedScore;

      if (state.active) {
        state.scoreSum += score;
        state.sourceObservationCount += 1;

        if (state.smoothedScore < this.config.closeThreshold) {
          completedEpisodes.push(this.closeEpisode(state, frame.timestampMs));
        }
        continue;
      }

      if (state.smoothedScore >= this.config.openThreshold) {
        if (state.positiveStreak === 0) {
          state.firstPositiveMs = frame.timestampMs;
          state.openingScoreSum = 0;
          state.openingObservationCount = 0;
        }
        state.positiveStreak += 1;
        state.openingScoreSum += score;
        state.openingObservationCount += 1;

        if (state.positiveStreak >= this.config.minOpenSamples) {
          state.active = true;
          state.startMs = state.firstPositiveMs ?? frame.timestampMs;
          state.scoreSum = state.openingScoreSum;
          state.sourceObservationCount = state.openingObservationCount;
        }
      } else {
        this.resetOpeningEvidence(state);
      }
    }

    completedEpisodes.push(...this.expireUnobservable(timestampMs));

    return {
      activeRelations: this.getActiveRelations(),
      completedEpisodes,
    };
  }

  flush(timestampMs: number): ActivityEpisode[] {
    if (!Number.isFinite(timestampMs)) throw new Error('timestampMs must be finite');
    const completed: ActivityEpisode[] = [];
    for (const state of this.states.values()) {
      if (state.active) completed.push(this.closeEpisode(state, timestampMs));
    }
    return completed;
  }

  getActiveRelations(): ActiveRelationState[] {
    return [...this.states.values()]
      .filter((state) =>
        state.active
        && state.startMs !== null
        && state.lastEvaluatedMs !== null
        && state.smoothedScore !== null
      )
      .map((state) => ({
        subjectId: state.subjectId,
        subjectKind: state.subjectKind,
        objectId: state.objectId,
        objectKind: state.objectKind,
        predicate: state.predicate,
        startMs: state.startMs as number,
        lastEvaluatedMs: state.lastEvaluatedMs as number,
        smoothedScore: state.smoothedScore as number,
        sourceObservationCount: state.sourceObservationCount,
      }));
  }

  private createState(frame: RelationFrameState): InternalRelationState {
    return {
      subjectId: frame.subjectId,
      subjectKind: frame.subjectKind,
      objectId: frame.objectId,
      objectKind: frame.objectKind,
      predicate: frame.predicate,
      smoothedScore: null,
      lastEvaluatedMs: null,
      unobservableSinceMs: null,
      positiveStreak: 0,
      firstPositiveMs: null,
      openingScoreSum: 0,
      openingObservationCount: 0,
      active: false,
      startMs: null,
      scoreSum: 0,
      sourceObservationCount: 0,
    };
  }

  private assertEndpointStability(
    state: InternalRelationState,
    frame: RelationFrameState,
  ): void {
    if (
      state.subjectKind !== frame.subjectKind
      || state.objectKind !== frame.objectKind
    ) {
      throw new Error('relation endpoint kind changed for an existing relation key');
    }
  }

  private expireUnobservable(timestampMs: number): ActivityEpisode[] {
    const completed: ActivityEpisode[] = [];
    for (const state of this.states.values()) {
      if (
        !state.active
        || state.unobservableSinceMs === null
        || timestampMs - state.unobservableSinceMs <= this.config.maxUnobservableMs
      ) {
        continue;
      }

      completed.push(this.closeEpisode(state, state.unobservableSinceMs));
    }
    return completed;
  }

  private closeEpisode(
    state: InternalRelationState,
    endMs: number,
  ): ActivityEpisode {
    const trackIds = unique([
      ...(state.subjectKind === 'track' ? [state.subjectId] : []),
      ...(state.objectKind === 'track' ? [state.objectId] : []),
    ]);
    const semanticElementIds = unique([
      ...(state.subjectKind === 'static_element' ? [state.subjectId] : []),
      ...(state.objectKind === 'static_element' ? [state.objectId] : []),
    ]);

    const episode: ActivityEpisode = {
      episodeId: `rel_${this.nextEpisodeNumber}`,
      sessionId: this.sessionId,
      startMs: state.startMs ?? endMs,
      endMs,
      trackIds,
      predicate: state.predicate,
      semanticElementIds,
      confidence: state.sourceObservationCount > 0
        ? clamp01(state.scoreSum / state.sourceObservationCount)
        : 0,
      sourceObservationCount: state.sourceObservationCount,
    };
    this.nextEpisodeNumber += 1;

    state.active = false;
    state.startMs = null;
    state.scoreSum = 0;
    state.sourceObservationCount = 0;
    state.unobservableSinceMs = null;
    this.resetOpeningEvidence(state);

    return episode;
  }

  private resetOpeningEvidence(state: InternalRelationState): void {
    state.positiveStreak = 0;
    state.firstPositiveMs = null;
    state.openingScoreSum = 0;
    state.openingObservationCount = 0;
  }
}

export const RELATION_TEMPORAL_DEFAULTS = { ...DEFAULT_CONFIG };
