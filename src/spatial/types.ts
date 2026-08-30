import type { EntityType, Point2D } from '../core/types';

export type Matrix3 = readonly [
  number, number, number,
  number, number, number,
  number, number, number
];

export interface CameraIntrinsics {
  fx: number;
  fy: number;
  cx: number;
  cy: number;
}

/** Brown-Conrady radial/tangential distortion coefficients. */
export interface BrownConradyDistortion {
  k1: number;
  k2: number;
  p1: number;
  p2: number;
  k3: number;
}

export interface SpatialCalibration {
  id: string;
  imageWidth: number;
  imageHeight: number;
  intrinsics?: CameraIntrinsics;
  distortion?: BrownConradyDistortion;
  /** Homography from undistorted image coordinates to local-ground plane coordinates. */
  imageToGroundH: Matrix3;
  /** Camera position expressed in the same local-ground coordinate system. */
  cameraGroundPoint: Point2D;
  cameraHeightMeters: number;
  /** Ground-plane coordinate units per meter, e.g. pixels per meter when calibration uses a raster map. */
  groundUnitsPerMeter: number;
  calibrationQuality: number;
  reprojectionErrorMedian?: number;
  reprojectionErrorP95?: number;
  createdAtIso: string;
  status: 'valid' | 'stale' | 'invalid';
}

export interface MetricPoint2D {
  xMeters: number;
  yMeters: number;
}

/**
 * Privacy-preserving spatial sample for local/private rendering.
 * renderTrackId MUST be ephemeral and scoped to one node/session.
 */
export interface SpatialTrackSample {
  schemaVersion: '2.0';
  sessionId: string;
  renderTrackId: string;
  timestampMs: number;
  entityType: EntityType;
  position: MetricPoint2D;
  headingDegrees?: number;
  speedMps?: number;
  confidence: number;
  calibrationQuality: number;
  motionQuality: number;
}

export type AnonymousAvatarShape =
  | 'capsule'
  | 'cycle'
  | 'small_prism'
  | 'car_block'
  | 'bus_block'
  | 'truck_block'
  | 'generic';

export interface AnonymousRenderEntity {
  renderTrackId: string;
  entityType: EntityType;
  shape: AnonymousAvatarShape;
  position: MetricPoint2D;
  headingDegrees?: number;
  speedMps?: number;
  confidence: number;
  opacity: number;
}

export interface SpatialQuality {
  calibrationQuality: number;
  trackingQuality: number;
  motionQuality: number;
  positionErrorMeters?: number;
  speedQuality?: number;
}
