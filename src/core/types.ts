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

/**
 * Segmento orientado desde `a` hacia `b`.
 * Las etiquetas describen el cruce transversal respecto de esa orientación.
 */
export interface DirectedLine {
  id: string;
  a: Point2D;
  b: Point2D;
  labelLeftToRight?: string;
  labelRightToLeft?: string;
}

export type CrossingDirection = 'LEFT_TO_RIGHT' | 'RIGHT_TO_LEFT';
export type CrossingPointSpace = 'image' | 'normalized_image' | 'local_ground';

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
  /** Explicit when the producer knows the coordinate domain. Legacy events may omit it. */
  crossingPointSpace?: CrossingPointSpace;
  confidence: number;
}
