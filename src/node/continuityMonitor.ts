export type ContinuityGapReason = 'visibility_hidden' | 'camera_ended' | 'manual_pause' | 'unknown';
export type ContinuityState = 'idle' | 'active' | 'paused' | 'stopped';

interface TimeInterval {
  startMs: number;
  endMs?: number;
}

interface GapInterval extends TimeInterval {
  reason: ContinuityGapReason;
}

export interface ContinuitySnapshot {
  state: ContinuityState;
  elapsedMs: number;
  activeMs: number;
  uptimeRatio: number;
  gapCount: number;
  longestGapMs: number;
  currentGapReason?: ContinuityGapReason;
}

function intervalDuration(interval: TimeInterval, nowMs: number): number {
  return Math.max(0, (interval.endMs ?? nowMs) - interval.startMs);
}

export class ObservationContinuityMonitor {
  private state: ContinuityState = 'idle';
  private startedAtMs: number | null = null;
  private stoppedAtMs: number | null = null;
  private activeIntervals: TimeInterval[] = [];
  private gaps: GapInterval[] = [];
  private lastTimestampMs: number | null = null;

  start(timestampMs: number): void {
    this.validateTimestamp(timestampMs);
    this.state = 'active';
    this.startedAtMs = timestampMs;
    this.stoppedAtMs = null;
    this.activeIntervals = [{ startMs: timestampMs }];
    this.gaps = [];
  }

  pause(reason: ContinuityGapReason, timestampMs: number): void {
    this.validateTimestamp(timestampMs);
    if (this.state !== 'active') return;
    const active = this.activeIntervals.at(-1);
    if (active && active.endMs === undefined) active.endMs = timestampMs;
    this.gaps.push({ startMs: timestampMs, reason });
    this.state = 'paused';
  }

  resume(timestampMs: number): void {
    this.validateTimestamp(timestampMs);
    if (this.state !== 'paused') return;
    const gap = this.gaps.at(-1);
    if (gap && gap.endMs === undefined) gap.endMs = timestampMs;
    this.activeIntervals.push({ startMs: timestampMs });
    this.state = 'active';
  }

  stop(timestampMs: number): void {
    this.validateTimestamp(timestampMs);
    if (this.state === 'idle' || this.state === 'stopped') return;
    if (this.state === 'active') {
      const active = this.activeIntervals.at(-1);
      if (active && active.endMs === undefined) active.endMs = timestampMs;
    } else if (this.state === 'paused') {
      const gap = this.gaps.at(-1);
      if (gap && gap.endMs === undefined) gap.endMs = timestampMs;
    }
    this.stoppedAtMs = timestampMs;
    this.state = 'stopped';
  }

  snapshot(nowMs: number): ContinuitySnapshot {
    if (this.startedAtMs === null) {
      return {
        state: this.state,
        elapsedMs: 0,
        activeMs: 0,
        uptimeRatio: 0,
        gapCount: 0,
        longestGapMs: 0,
      };
    }

    const effectiveNow = this.stoppedAtMs ?? nowMs;
    const elapsedMs = Math.max(0, effectiveNow - this.startedAtMs);
    const activeMs = this.activeIntervals.reduce(
      (sum, interval) => sum + intervalDuration(interval, effectiveNow),
      0,
    );
    const longestGapMs = this.gaps.reduce(
      (maximum, gap) => Math.max(maximum, intervalDuration(gap, effectiveNow)),
      0,
    );
    const currentGap = this.state === 'paused' ? this.gaps.at(-1) : undefined;

    return {
      state: this.state,
      elapsedMs,
      activeMs,
      uptimeRatio: elapsedMs <= 0 ? 0 : Math.min(1, activeMs / elapsedMs),
      gapCount: this.gaps.length,
      longestGapMs,
      ...(currentGap === undefined ? {} : { currentGapReason: currentGap.reason }),
    };
  }

  private validateTimestamp(timestampMs: number): void {
    if (!Number.isFinite(timestampMs)) throw new Error('Continuity timestamps must be finite');
    if (this.lastTimestampMs !== null && timestampMs < this.lastTimestampMs) {
      throw new Error('Continuity timestamps must be monotonic');
    }
    this.lastTimestampMs = timestampMs;
  }
}
