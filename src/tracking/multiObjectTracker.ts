import type {
  BoundingBox,
  MobilityEntityObservation,
  Point2D,
  Track,
  TrackSample,
  TrackState,
} from '../core/types';
import { solveMinimumCostAssignment } from './hungarian';

export interface MultiObjectTrackerConfig {
  highConfidence: number;
  lowConfidence: number;
  confirmationHits: number;
  maxLostMs: number;
  maxTentativeMisses: number;
  maxDistancePx: number;
  minIoU: number;
  maxAssociationCost: number;
  velocitySmoothing: number;
  historyLimit: number;
}

export interface TrackerVelocity {
  xPxPerMs: number;
  yPxPerMs: number;
}

export interface TrackedEntity extends Track {
  hits: number;
  totalMisses: number;
  consecutiveMisses: number;
  velocity: TrackerVelocity;
  quality: number;
  lastObservationConfidence: number;
}

export interface TrackerMatch {
  trackId: string;
  detectionIndex: number;
  stage: 'high' | 'low';
  cost: number;
}

export interface TrackerUpdateResult {
  tracks: TrackedEntity[];
  confirmedTracks: TrackedEntity[];
  matches: TrackerMatch[];
  createdTrackIds: string[];
  removedTrackIds: string[];
}

const DEFAULT_CONFIG: MultiObjectTrackerConfig = {
  highConfidence: 0.65,
  lowConfidence: 0.2,
  confirmationHits: 3,
  maxLostMs: 1800,
  maxTentativeMisses: 1,
  maxDistancePx: 180,
  minIoU: 0.01,
  maxAssociationCost: 0.92,
  velocitySmoothing: 0.65,
  historyLimit: 120,
};

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function center(box: BoundingBox): Point2D {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function area(box: BoundingBox): number {
  return Math.max(0, box.width) * Math.max(0, box.height);
}

function intersectionOverUnion(a: BoundingBox, b: BoundingBox): number {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  const union = area(a) + area(b) - intersection;
  return union <= 0 ? 0 : intersection / union;
}

function shiftBox(box: BoundingBox, dx: number, dy: number): BoundingBox {
  return { x: box.x + dx, y: box.y + dy, width: box.width, height: box.height };
}

function normalizedSizePenalty(a: BoundingBox, b: BoundingBox): number {
  const aArea = Math.max(area(a), 1);
  const bArea = Math.max(area(b), 1);
  const ratio = Math.min(aArea, bArea) / Math.max(aArea, bArea);
  return 1 - ratio;
}

function directionPenalty(
  velocity: TrackerVelocity,
  lastPoint: Point2D,
  observationPoint: Point2D,
): number {
  const vx = velocity.xPxPerMs;
  const vy = velocity.yPxPerMs;
  const ox = observationPoint.x - lastPoint.x;
  const oy = observationPoint.y - lastPoint.y;
  const velocityMagnitude = Math.hypot(vx, vy);
  const observedMagnitude = Math.hypot(ox, oy);
  if (velocityMagnitude < 1e-4 || observedMagnitude < 2) return 0;
  const cosine = Math.max(-1, Math.min(1, (vx * ox + vy * oy) / (velocityMagnitude * observedMagnitude)));
  return (1 - cosine) / 2;
}

function cloneTrack(track: TrackedEntity): TrackedEntity {
  return {
    ...track,
    velocity: { ...track.velocity },
    samples: track.samples.map((sample) => ({
      ...sample,
      point: { ...sample.point },
      bbox: { ...sample.bbox },
    })),
  };
}

interface AssociationMatch {
  trackIndex: number;
  detectionIndex: number;
  cost: number;
}

export class MultiObjectTracker {
  private readonly config: MultiObjectTrackerConfig;
  private tracks: TrackedEntity[] = [];
  private nextTrackNumber = 1;

  constructor(config: Partial<MultiObjectTrackerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    if (this.config.lowConfidence < 0 || this.config.highConfidence > 1) {
      throw new Error('Tracker confidence thresholds must be within [0, 1]');
    }
    if (this.config.lowConfidence > this.config.highConfidence) {
      throw new Error('lowConfidence cannot exceed highConfidence');
    }
    if (this.config.confirmationHits < 1) {
      throw new Error('confirmationHits must be at least 1');
    }
  }

  reset(): void {
    this.tracks = [];
    this.nextTrackNumber = 1;
  }

  getTracks(includeRemoved = false): TrackedEntity[] {
    return this.tracks
      .filter((track) => includeRemoved || track.state !== 'removed')
      .map(cloneTrack);
  }

  update(
    detections: readonly MobilityEntityObservation[],
    timestampMs: number,
  ): TrackerUpdateResult {
    if (!Number.isFinite(timestampMs)) {
      throw new Error('timestampMs must be finite');
    }

    const eligibleDetectionIndices = detections
      .map((detection, index) => ({ detection, index }))
      .filter(({ detection }) => detection.confidence >= this.config.lowConfidence);
    const high = eligibleDetectionIndices
      .filter(({ detection }) => detection.confidence >= this.config.highConfidence)
      .map(({ index }) => index);
    const low = eligibleDetectionIndices
      .filter(({ detection }) => detection.confidence < this.config.highConfidence)
      .map(({ index }) => index);

    const activeTrackIndices = this.tracks
      .map((track, index) => ({ track, index }))
      .filter(({ track }) => track.state !== 'removed')
      .map(({ index }) => index);

    const matches: TrackerMatch[] = [];
    const matchedTrackIndices = new Set<number>();
    const matchedDetectionIndices = new Set<number>();

    const stageOne = this.associate(activeTrackIndices, high, detections, timestampMs, 1);
    for (const match of stageOne) {
      this.applyMatch(match.trackIndex, detections[match.detectionIndex], timestampMs);
      matchedTrackIndices.add(match.trackIndex);
      matchedDetectionIndices.add(match.detectionIndex);
      const track = this.tracks[match.trackIndex];
      if (track) {
        matches.push({
          trackId: track.id,
          detectionIndex: match.detectionIndex,
          stage: 'high',
          cost: match.cost,
        });
      }
    }

    const stageTwoTrackIndices = activeTrackIndices.filter((index) => {
      if (matchedTrackIndices.has(index)) return false;
      const track = this.tracks[index];
      return track?.state === 'confirmed' || track?.state === 'lost';
    });
    const availableLow = low.filter((index) => !matchedDetectionIndices.has(index));
    const stageTwo = this.associate(
      stageTwoTrackIndices,
      availableLow,
      detections,
      timestampMs,
      1.2,
    );
    for (const match of stageTwo) {
      this.applyMatch(match.trackIndex, detections[match.detectionIndex], timestampMs);
      matchedTrackIndices.add(match.trackIndex);
      matchedDetectionIndices.add(match.detectionIndex);
      const track = this.tracks[match.trackIndex];
      if (track) {
        matches.push({
          trackId: track.id,
          detectionIndex: match.detectionIndex,
          stage: 'low',
          cost: match.cost,
        });
      }
    }

    const removedTrackIds: string[] = [];
    for (const trackIndex of activeTrackIndices) {
      if (matchedTrackIndices.has(trackIndex)) continue;
      const removed = this.applyMiss(trackIndex, timestampMs);
      if (removed) removedTrackIds.push(removed);
    }

    const createdTrackIds: string[] = [];
    for (const detectionIndex of high) {
      if (matchedDetectionIndices.has(detectionIndex)) continue;
      const detection = detections[detectionIndex];
      if (!detection) continue;
      const track = this.createTrack(detection, timestampMs);
      this.tracks.push(track);
      createdTrackIds.push(track.id);
    }

    this.pruneHistory();

    const visibleTracks = this.getTracks(false);
    return {
      tracks: visibleTracks,
      confirmedTracks: visibleTracks.filter((track) => track.state === 'confirmed'),
      matches,
      createdTrackIds,
      removedTrackIds,
    };
  }

  private associate(
    trackIndices: readonly number[],
    detectionIndices: readonly number[],
    detections: readonly MobilityEntityObservation[],
    timestampMs: number,
    distanceMultiplier: number,
  ): AssociationMatch[] {
    if (trackIndices.length === 0 || detectionIndices.length === 0) return [];

    const costMatrix = trackIndices.map((trackIndex) => detectionIndices.map((detectionIndex) => {
      const track = this.tracks[trackIndex];
      const detection = detections[detectionIndex];
      if (!track || !detection) return Number.POSITIVE_INFINITY;
      return this.associationCost(track, detection, timestampMs, distanceMultiplier);
    }));

    return solveMinimumCostAssignment(costMatrix, this.config.maxAssociationCost)
      .map((assignment): AssociationMatch | null => {
        const trackIndex = trackIndices[assignment.row];
        const detectionIndex = detectionIndices[assignment.column];
        if (trackIndex === undefined || detectionIndex === undefined) return null;
        return { trackIndex, detectionIndex, cost: assignment.cost };
      })
      .filter((match): match is AssociationMatch => match !== null);
  }

  private associationCost(
    track: TrackedEntity,
    detection: MobilityEntityObservation,
    timestampMs: number,
    distanceMultiplier: number,
  ): number {
    if (track.entityType !== detection.entityType) return Number.POSITIVE_INFINITY;
    const last = track.samples.at(-1);
    if (!last) return Number.POSITIVE_INFINITY;

    const dt = Math.max(0, timestampMs - track.updatedAtMs);
    const predictedPoint = {
      x: last.point.x + track.velocity.xPxPerMs * dt,
      y: last.point.y + track.velocity.yPxPerMs * dt,
    };
    const predictedBox = shiftBox(
      last.bbox,
      predictedPoint.x - last.point.x,
      predictedPoint.y - last.point.y,
    );
    const distancePx = Math.hypot(
      detection.groundPoint.x - predictedPoint.x,
      detection.groundPoint.y - predictedPoint.y,
    );
    const stateMultiplier = track.state === 'lost' ? 1.35 : 1;
    const maxDistance = this.config.maxDistancePx * distanceMultiplier * stateMultiplier;
    const iou = intersectionOverUnion(predictedBox, detection.bbox);

    if (distancePx > maxDistance && iou < this.config.minIoU) {
      return Number.POSITIVE_INFINITY;
    }

    const distanceCost = Math.min(1.5, distancePx / Math.max(maxDistance, 1));
    const iouCost = 1 - iou;
    const motionCost = directionPenalty(track.velocity, last.point, detection.groundPoint);
    const sizeCost = normalizedSizePenalty(predictedBox, detection.bbox);

    return 0.55 * distanceCost + 0.28 * iouCost + 0.12 * motionCost + 0.05 * sizeCost;
  }

  private applyMatch(
    trackIndex: number,
    detection: MobilityEntityObservation | undefined,
    timestampMs: number,
  ): void {
    const track = this.tracks[trackIndex];
    if (!track || !detection) return;
    const previous = track.samples.at(-1);

    if (previous) {
      const dt = timestampMs - previous.timestampMs;
      if (dt > 0) {
        const observedVelocity = {
          xPxPerMs: (detection.groundPoint.x - previous.point.x) / dt,
          yPxPerMs: (detection.groundPoint.y - previous.point.y) / dt,
        };

        // The first measured displacement establishes the motion prior directly.
        // Smoothing against an initial zero velocity would underpredict motion
        // exactly when two objects first approach a crossing.
        if (track.hits <= 1) {
          track.velocity = observedVelocity;
        } else {
          const keep = clamp01(this.config.velocitySmoothing);
          track.velocity = {
            xPxPerMs: keep * track.velocity.xPxPerMs + (1 - keep) * observedVelocity.xPxPerMs,
            yPxPerMs: keep * track.velocity.yPxPerMs + (1 - keep) * observedVelocity.yPxPerMs,
          };
        }
      }
    }

    const sample: TrackSample = {
      timestampMs,
      point: { ...detection.groundPoint },
      bbox: { ...detection.bbox },
      confidence: detection.confidence,
    };
    track.samples.push(sample);
    track.updatedAtMs = timestampMs;
    track.hits += 1;
    track.consecutiveMisses = 0;
    track.lastObservationConfidence = detection.confidence;

    if (track.state === 'lost') {
      track.state = 'confirmed';
    } else if (track.state === 'tentative' && track.hits >= this.config.confirmationHits) {
      track.state = 'confirmed';
    }

    track.quality = this.trackQuality(track);
  }

  private applyMiss(trackIndex: number, timestampMs: number): string | null {
    const track = this.tracks[trackIndex];
    if (!track || track.state === 'removed') return null;

    track.totalMisses += 1;
    track.consecutiveMisses += 1;

    if (track.state === 'tentative') {
      if (track.consecutiveMisses > this.config.maxTentativeMisses) {
        track.state = 'removed';
        track.quality = this.trackQuality(track);
        return track.id;
      }
      track.quality = this.trackQuality(track);
      return null;
    }

    if (timestampMs - track.updatedAtMs > this.config.maxLostMs) {
      track.state = 'removed';
      track.quality = this.trackQuality(track);
      return track.id;
    }

    track.state = 'lost';
    track.quality = this.trackQuality(track);
    return null;
  }

  private createTrack(detection: MobilityEntityObservation, timestampMs: number): TrackedEntity {
    const id = `t_${this.nextTrackNumber}`;
    this.nextTrackNumber += 1;
    const initialState: TrackState = this.config.confirmationHits <= 1 ? 'confirmed' : 'tentative';
    return {
      id,
      entityType: detection.entityType,
      state: initialState,
      createdAtMs: timestampMs,
      updatedAtMs: timestampMs,
      samples: [{
        timestampMs,
        point: { ...detection.groundPoint },
        bbox: { ...detection.bbox },
        confidence: detection.confidence,
      }],
      hits: 1,
      totalMisses: 0,
      consecutiveMisses: 0,
      velocity: { xPxPerMs: 0, yPxPerMs: 0 },
      quality: detection.confidence * 0.6,
      lastObservationConfidence: detection.confidence,
    };
  }

  private trackQuality(track: TrackedEntity): number {
    const continuity = track.hits / Math.max(1, track.hits + track.totalMisses);
    const maturity = clamp01(track.hits / Math.max(1, this.config.confirmationHits));
    const stateFactor = track.state === 'confirmed' ? 1 : track.state === 'lost' ? 0.65 : 0.45;
    return clamp01(
      0.42 * track.lastObservationConfidence
      + 0.28 * continuity
      + 0.2 * maturity
      + 0.1 * stateFactor,
    );
  }

  private pruneHistory(): void {
    for (const track of this.tracks) {
      if (track.samples.length > this.config.historyLimit) {
        track.samples.splice(0, track.samples.length - this.config.historyLimit);
      }
    }
  }
}

export const TRACKER_DEFAULTS = { ...DEFAULT_CONFIG };
export const trackingGeometry = { center, intersectionOverUnion };
