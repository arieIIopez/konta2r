import type { LineCrossingEvent } from '../core/types';
import {
  canonicalPointToNormalized,
  imagePointToCanonical,
  normalizedLineToCanonical,
  validateNormalizedLine,
  type NormalizedDirectedLine,
} from '../geometry/normalized';
import {
  LineCrossingDetector,
  type LineCrossingCandidate,
} from '../spatial-events/line-crossing';
import type {
  TrackedEntity,
  TrackerUpdateResult,
} from '../tracking/multiObjectTracker';

export interface CountingEngineOptions {
  /** Deadzone as a fraction of frame height in aspect-correct canonical space. */
  deadzoneRelativeToFrameHeight?: number;
  minCrossingIntervalMs?: number;
  pendingConfirmationMs?: number;
  maxAspectRatioDrift?: number;
}

interface PendingCrossing {
  candidate: LineCrossingCandidate;
  expiresAtMs: number;
}

function pendingKey(trackId: string, geometryId: string): string {
  return `${trackId}|${geometryId}`;
}

function eventId(
  sessionId: string,
  candidate: LineCrossingCandidate,
): string {
  return [
    'cross',
    sessionId,
    candidate.geometryId,
    candidate.trackId,
    candidate.timestampMs,
    candidate.direction,
  ].join(':');
}

export class TrackCountingEngine {
  private readonly lines: NormalizedDirectedLine[];
  private readonly deadzoneRelativeToFrameHeight: number;
  private readonly minCrossingIntervalMs: number;
  private readonly pendingConfirmationMs: number;
  private readonly maxAspectRatioDrift: number;
  private detectors = new Map<string, LineCrossingDetector>();
  private pending = new Map<string, PendingCrossing>();
  private lastProcessedSampleByTrack = new Map<string, number>();
  private activeAspectRatio: number | null = null;

  constructor(
    lines: readonly NormalizedDirectedLine[],
    options: CountingEngineOptions = {},
  ) {
    if (lines.length === 0) throw new Error('At least one normalized counting line is required');
    this.lines = lines.map((line) => {
      validateNormalizedLine(line);
      return {
        ...line,
        a: { ...line.a },
        b: { ...line.b },
      };
    });
    this.deadzoneRelativeToFrameHeight = Math.max(0, options.deadzoneRelativeToFrameHeight ?? 0.008);
    this.minCrossingIntervalMs = Math.max(0, options.minCrossingIntervalMs ?? 900);
    this.pendingConfirmationMs = Math.max(0, options.pendingConfirmationMs ?? 1500);
    this.maxAspectRatioDrift = Math.max(0, options.maxAspectRatioDrift ?? 0.015);
  }

  reset(): void {
    for (const detector of this.detectors.values()) detector.reset();
    this.detectors.clear();
    this.pending.clear();
    this.lastProcessedSampleByTrack.clear();
    this.activeAspectRatio = null;
  }

  update(
    tracking: TrackerUpdateResult,
    frameWidth: number,
    frameHeight: number,
    frameTimestampMs: number,
    sessionId: string,
  ): LineCrossingEvent[] {
    if (!(frameWidth > 0) || !(frameHeight > 0)) {
      throw new Error('Frame dimensions must be greater than zero');
    }
    if (!Number.isFinite(frameTimestampMs)) throw new Error('frameTimestampMs must be finite');
    if (sessionId.trim().length === 0) throw new Error('sessionId is required');

    this.ensureGeometry(frameWidth, frameHeight);
    this.forgetRemovedTracks(tracking.removedTrackIds);

    const events: LineCrossingEvent[] = [];
    const trackById = new Map(tracking.tracks.map((track) => [track.id, track]));

    for (const track of tracking.tracks) {
      if (track.state === 'removed' || track.state === 'lost') continue;
      const sample = track.samples.at(-1);
      if (!sample) continue;
      const lastProcessed = this.lastProcessedSampleByTrack.get(track.id);
      if (lastProcessed !== undefined && sample.timestampMs <= lastProcessed) continue;
      this.lastProcessedSampleByTrack.set(track.id, sample.timestampMs);

      const canonicalPoint = imagePointToCanonical(sample.point, frameHeight);
      for (const [geometryId, detector] of this.detectors) {
        const candidate = detector.update({
          trackId: track.id,
          timestampMs: sample.timestampMs,
          point: canonicalPoint,
          confidence: Math.min(sample.confidence, track.quality),
        });
        if (!candidate) continue;

        if (track.state === 'confirmed') {
          events.push(this.toEvent(candidate, track, frameWidth, frameHeight, sessionId));
        } else if (track.state === 'tentative' && this.pendingConfirmationMs > 0) {
          this.pending.set(pendingKey(track.id, geometryId), {
            candidate,
            expiresAtMs: candidate.timestampMs + this.pendingConfirmationMs,
          });
        }
      }
    }

    for (const [key, pending] of [...this.pending.entries()]) {
      const track = trackById.get(pending.candidate.trackId);
      if (!track || track.state === 'removed' || frameTimestampMs > pending.expiresAtMs) {
        this.pending.delete(key);
        continue;
      }
      if (track.state === 'confirmed') {
        events.push(this.toEvent(pending.candidate, track, frameWidth, frameHeight, sessionId));
        this.pending.delete(key);
      }
    }

    return events.sort((a, b) => a.timestampMs - b.timestampMs || a.eventId.localeCompare(b.eventId));
  }

  private ensureGeometry(frameWidth: number, frameHeight: number): void {
    const aspectRatio = frameWidth / frameHeight;
    const drift = this.activeAspectRatio === null
      ? 0
      : Math.abs(aspectRatio - this.activeAspectRatio) / Math.max(this.activeAspectRatio, 1e-9);

    if (this.detectors.size > 0 && drift <= this.maxAspectRatioDrift) return;

    this.detectors.clear();
    this.pending.clear();
    this.lastProcessedSampleByTrack.clear();
    for (const line of this.lines) {
      this.detectors.set(line.id, new LineCrossingDetector(
        normalizedLineToCanonical(line, frameWidth, frameHeight),
        {
          deadzone: this.deadzoneRelativeToFrameHeight,
          minCrossingIntervalMs: this.minCrossingIntervalMs,
        },
      ));
    }
    this.activeAspectRatio = aspectRatio;
  }

  private forgetRemovedTracks(trackIds: readonly string[]): void {
    for (const trackId of trackIds) {
      this.lastProcessedSampleByTrack.delete(trackId);
      for (const detector of this.detectors.values()) detector.forgetTrack(trackId);
      for (const key of [...this.pending.keys()]) {
        if (key.startsWith(`${trackId}|`)) this.pending.delete(key);
      }
    }
  }

  private toEvent(
    candidate: LineCrossingCandidate,
    track: TrackedEntity,
    frameWidth: number,
    frameHeight: number,
    sessionId: string,
  ): LineCrossingEvent {
    const normalizedPoint = canonicalPointToNormalized(
      candidate.crossingPoint,
      frameWidth,
      frameHeight,
    );
    return {
      eventId: eventId(sessionId, candidate),
      sessionId,
      trackId: candidate.trackId,
      entityType: track.entityType,
      eventType: 'line_crossing',
      timestampMs: candidate.timestampMs,
      geometryId: candidate.geometryId,
      direction: candidate.direction,
      crossingPoint: normalizedPoint,
      crossingPointSpace: 'normalized_image',
      confidence: Math.min(candidate.confidence, track.quality),
    };
  }
}
