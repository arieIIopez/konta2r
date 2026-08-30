export type EntityType =
  | 'pedestrian'
  | 'cyclist'
  | 'skater'
  | 'motorcyclist'
  | 'car'
  | 'bus'
  | 'truck'
  | 'pet'
  | 'unknown';

export interface Point2D {
  x: number;
  y: number;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RawDetection {
  classId: number;
  className: string;
  confidence: number;
  bbox: BoundingBox;
}

export interface MobilityEntityObservation {
  entityType: EntityType;
  confidence: number;
  groundPoint: Point2D;
  bbox: BoundingBox;
  sourceDetections: RawDetection[];
}

export type TrackState = 'tentative' | 'confirmed' | 'lost' | 'removed';

export interface TrackSample {
  timestampMs: number;
  point: Point2D;
  bbox: BoundingBox;
  confidence: number;
}

export interface Track {
  id: string;
  entityType: EntityType;
  state: TrackState;
  createdAtMs: number;
  updatedAtMs: number;
  samples: TrackSample[];
}

export interface DirectedLine {
  id: string;
  a: Point2D;
  b: Point2D;
  labelAToB?: string;
  labelBToA?: string;
}

export type CrossingDirection = 'A_TO_B' | 'B_TO_A';

export interface LineCrossingEvent {
  eventId: string;
  sessionId: string;
  trackId: string;
  entityType: EntityType;
  eventType: 'line_crossing';
  timestampMs: number;
  geometryId: string;
  direction: CrossingDirection;
  crossingPoint: Point2D;
  confidence: number;
}
