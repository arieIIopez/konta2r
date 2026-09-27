import type { CrossingDirection, DirectedLine, Point2D } from '../core/types';
import { classifyLineSide, detectFiniteLineCrossing } from '../geometry/segment';

export interface TrackPointSample {
  trackId: string;
  timestampMs: number;
  point: Point2D;
  confidence: number;
}

export interface LineCrossingCandidate {
  trackId: string;
  geometryId: string;
  timestampMs: number;
  direction: CrossingDirection;
  crossingPoint: Point2D;
  confidence: number;
}

interface TrackLineState {
  stableSide: 'LEFT' | 'RIGHT' | null;
  stablePoint: Point2D | null;
  stableTimestampMs: number | null;
  stableConfidence: number | null;
  lastCrossingAtMs: number | null;
}

export interface LineCrossingDetectorOptions {
  deadzone: number;
  minCrossingIntervalMs: number;
}

const DEFAULT_OPTIONS: LineCrossingDetectorOptions = {
  deadzone: 8,
  minCrossingIntervalMs: 900,
};

/**
 * Stateful line-crossing detector.
 *
 * Samples inside the deadzone never change the last stable side. This provides
 * hysteresis without inventing a crossing from detector jitter. A crossing is
 * emitted only when two stable observations on opposite sides define a
 * trajectory segment that intersects the finite counting segment.
 */
export class LineCrossingDetector {
  private readonly line: DirectedLine;
  private readonly options: LineCrossingDetectorOptions;
  private readonly stateByTrack = new Map<string, TrackLineState>();

  constructor(line: DirectedLine, options: Partial<LineCrossingDetectorOptions> = {}) {
    this.line = line;
    this.options = { ...DEFAULT_OPTIONS, ...options };

    if (this.options.deadzone < 0) {
      throw new Error('deadzone must be >= 0');
    }
    if (this.options.minCrossingIntervalMs < 0) {
      throw new Error('minCrossingIntervalMs must be >= 0');
    }
  }

  update(sample: TrackPointSample): LineCrossingCandidate | null {
    const side = classifyLineSide(sample.point, this.line, this.options.deadzone);
    const state = this.stateByTrack.get(sample.trackId) ?? this.createEmptyState();

    if (side === 'ON_LINE') {
      this.stateByTrack.set(sample.trackId, state);
      return null;
    }

    if (
      state.stableSide === null ||
      state.stablePoint === null ||
      state.stableTimestampMs === null ||
      state.stableConfidence === null
    ) {
      this.setStableSample(state, side, sample);
      this.stateByTrack.set(sample.trackId, state);
      return null;
    }

    if (state.stableSide === side) {
      this.setStableSample(state, side, sample);
      this.stateByTrack.set(sample.trackId, state);
      return null;
    }

    const crossing = detectFiniteLineCrossing(
      state.stablePoint,
      sample.point,
      this.line,
      this.options.deadzone,
    );

    const previousTimestampMs = state.stableTimestampMs;
    const previousConfidence = state.stableConfidence;

    // The current sample becomes the new stable state even when the candidate
    // is suppressed by the cooldown. That prevents repeated attempts from the
    // same physical crossing.
    this.setStableSample(state, side, sample);

    if (!crossing) {
      this.stateByTrack.set(sample.trackId, state);
      return null;
    }

    if (
      state.lastCrossingAtMs !== null &&
      sample.timestampMs - state.lastCrossingAtMs < this.options.minCrossingIntervalMs
    ) {
      this.stateByTrack.set(sample.trackId, state);
      return null;
    }

    const timestampMs = Math.round(
      previousTimestampMs +
        crossing.trajectoryT * (sample.timestampMs - previousTimestampMs),
    );

    const confidence =
      previousConfidence + crossing.trajectoryT * (sample.confidence - previousConfidence);

    state.lastCrossingAtMs = timestampMs;
    this.stateByTrack.set(sample.trackId, state);

    return {
      trackId: sample.trackId,
      geometryId: this.line.id,
      timestampMs,
      direction: crossing.direction,
      crossingPoint: crossing.point,
      confidence,
    };
  }

  forgetTrack(trackId: string): void {
    this.stateByTrack.delete(trackId);
  }

  reset(): void {
    this.stateByTrack.clear();
  }

  private createEmptyState(): TrackLineState {
    return {
      stableSide: null,
      stablePoint: null,
      stableTimestampMs: null,
      stableConfidence: null,
      lastCrossingAtMs: null,
    };
  }

  private setStableSample(
    state: TrackLineState,
    side: 'LEFT' | 'RIGHT',
    sample: TrackPointSample,
  ): void {
    state.stableSide = side;
    state.stablePoint = sample.point;
    state.stableTimestampMs = sample.timestampMs;
    state.stableConfidence = sample.confidence;
  }
}
