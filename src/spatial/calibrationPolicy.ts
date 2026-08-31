import type { CalibrationFitResult } from './calibration';

export type SpatialCapability =
  | 'counting'
  | 'direction'
  | 'approximate_trajectory'
  | 'metric_position'
  | 'metric_speed'
  | 'advanced_interactions';

export interface SpatialCapabilityThresholds {
  trajectoryQuality: number;
  metricPositionQuality: number;
  metricSpeedQuality: number;
  advancedQuality: number;
  maxMedianErrorMetersForPosition: number;
  maxP95ErrorMetersForSpeed: number;
  maxP95ErrorMetersForAdvanced: number;
}

export interface SpatialCapabilityContext {
  calibration?: CalibrationFitResult;
  correspondenceCoverage?: number;
  trackingQuality?: number;
  motionQuality?: number;
  cameraStable?: boolean;
}

export interface CapabilityDecision {
  capability: SpatialCapability;
  enabled: boolean;
  quality: number;
  reasons: string[];
}

export interface SpatialCapabilityReport {
  overallQuality: number;
  decisions: Record<SpatialCapability, CapabilityDecision>;
}

export const DEFAULT_SPATIAL_CAPABILITY_THRESHOLDS: SpatialCapabilityThresholds = {
  trajectoryQuality: 0.5,
  metricPositionQuality: 0.7,
  metricSpeedQuality: 0.8,
  advancedQuality: 0.9,
  maxMedianErrorMetersForPosition: 0.5,
  maxP95ErrorMetersForSpeed: 0.8,
  maxP95ErrorMetersForAdvanced: 0.45,
};

function clamp01(value: number | undefined, fallback = 0): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(1, Math.max(0, value));
}

function decision(
  capability: SpatialCapability,
  enabled: boolean,
  quality: number,
  reasons: string[],
): CapabilityDecision {
  return { capability, enabled, quality: clamp01(quality), reasons };
}

/**
 * Converts geometric/temporal quality into explicit permissions for derived
 * mobility metrics. Counting and direction can remain available without a
 * metric calibration; physical magnitudes require progressively stronger
 * evidence.
 */
export function evaluateSpatialCapabilities(
  context: SpatialCapabilityContext,
  thresholds: SpatialCapabilityThresholds = DEFAULT_SPATIAL_CAPABILITY_THRESHOLDS,
): SpatialCapabilityReport {
  const calibration = context.calibration;
  const trackingQuality = clamp01(context.trackingQuality, 0.5);
  const motionQuality = clamp01(context.motionQuality, trackingQuality);
  const coverage = clamp01(context.correspondenceCoverage, calibration ? 0.5 : 0);
  const cameraStable = context.cameraStable ?? true;
  const calibrationQuality = calibration?.status === 'valid'
    ? clamp01(calibration.calibrationQuality)
    : 0;

  const geometryQuality = Math.min(calibrationQuality, coverage);
  const trajectoryQuality = Math.min(trackingQuality, motionQuality);
  const physicalQuality = Math.min(geometryQuality, trajectoryQuality);

  const countingReasons: string[] = [];
  if (trackingQuality < 0.35) {
    countingReasons.push('tracking_quality_low');
  }
  const countingEnabled = trackingQuality >= 0.35;

  const directionReasons: string[] = [];
  if (!countingEnabled) {
    directionReasons.push('counting_not_reliable');
  }
  if (motionQuality < 0.4) {
    directionReasons.push('motion_quality_low');
  }
  const directionEnabled = countingEnabled && motionQuality >= 0.4;

  const trajectoryReasons: string[] = [];
  if (!directionEnabled) {
    trajectoryReasons.push('direction_not_reliable');
  }
  if (trajectoryQuality < thresholds.trajectoryQuality) {
    trajectoryReasons.push('trajectory_quality_below_threshold');
  }
  const approximateTrajectoryEnabled = directionEnabled
    && trajectoryQuality >= thresholds.trajectoryQuality;

  const positionReasons: string[] = [];
  if (!calibration || calibration.status !== 'valid') {
    positionReasons.push('valid_metric_calibration_required');
  }
  if (!cameraStable) {
    positionReasons.push('camera_moved_recalibration_required');
  }
  if (coverage < 0.45) {
    positionReasons.push('calibration_points_insufficiently_distributed');
  }
  if (physicalQuality < thresholds.metricPositionQuality) {
    positionReasons.push('metric_position_quality_below_threshold');
  }
  if (
    calibration
    && calibration.reprojectionErrorMedianMeters > thresholds.maxMedianErrorMetersForPosition
  ) {
    positionReasons.push('median_reprojection_error_too_high');
  }
  const metricPositionEnabled = Boolean(
    calibration
    && calibration.status === 'valid'
    && cameraStable
    && coverage >= 0.45
    && physicalQuality >= thresholds.metricPositionQuality
    && calibration.reprojectionErrorMedianMeters <= thresholds.maxMedianErrorMetersForPosition,
  );

  const speedReasons: string[] = [];
  if (!metricPositionEnabled) {
    speedReasons.push('metric_position_not_reliable');
  }
  if (physicalQuality < thresholds.metricSpeedQuality) {
    speedReasons.push('metric_speed_quality_below_threshold');
  }
  if (
    calibration
    && calibration.reprojectionErrorP95Meters > thresholds.maxP95ErrorMetersForSpeed
  ) {
    speedReasons.push('p95_reprojection_error_too_high_for_speed');
  }
  const metricSpeedEnabled = Boolean(
    metricPositionEnabled
    && calibration
    && physicalQuality >= thresholds.metricSpeedQuality
    && calibration.reprojectionErrorP95Meters <= thresholds.maxP95ErrorMetersForSpeed,
  );

  const advancedReasons: string[] = [];
  if (!metricSpeedEnabled) {
    advancedReasons.push('metric_speed_not_reliable');
  }
  if (physicalQuality < thresholds.advancedQuality) {
    advancedReasons.push('advanced_quality_below_threshold');
  }
  if (
    calibration
    && calibration.reprojectionErrorP95Meters > thresholds.maxP95ErrorMetersForAdvanced
  ) {
    advancedReasons.push('p95_reprojection_error_too_high_for_interactions');
  }
  const advancedEnabled = Boolean(
    metricSpeedEnabled
    && calibration
    && physicalQuality >= thresholds.advancedQuality
    && calibration.reprojectionErrorP95Meters <= thresholds.maxP95ErrorMetersForAdvanced,
  );

  const decisions: Record<SpatialCapability, CapabilityDecision> = {
    counting: decision('counting', countingEnabled, trackingQuality, countingReasons),
    direction: decision('direction', directionEnabled, Math.min(trackingQuality, motionQuality), directionReasons),
    approximate_trajectory: decision(
      'approximate_trajectory',
      approximateTrajectoryEnabled,
      trajectoryQuality,
      trajectoryReasons,
    ),
    metric_position: decision('metric_position', metricPositionEnabled, physicalQuality, positionReasons),
    metric_speed: decision('metric_speed', metricSpeedEnabled, physicalQuality, speedReasons),
    advanced_interactions: decision('advanced_interactions', advancedEnabled, physicalQuality, advancedReasons),
  };

  return {
    overallQuality: Math.min(
      countingEnabled ? trackingQuality : 0,
      calibration ? Math.max(physicalQuality, 0.01) : trajectoryQuality,
    ),
    decisions,
  };
}
