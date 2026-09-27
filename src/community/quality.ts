export type NodeQualityDimensionName =
  | 'detection'
  | 'tracking'
  | 'geometry'
  | 'temporal'
  | 'device'
  | 'validation'
  | 'consistency';

export interface NodeQualityDimension {
  value: number;
  weight: number;
  applicable: boolean;
  evidence?: string;
}

export interface NodeQualityInput {
  detection: number;
  tracking: number;
  temporal: number;
  device: number;
  validation?: number;
  consistency?: number;
  geometry?: number;
}

export interface NodeQualityScore {
  methodVersion: '0.1';
  overall: number;
  status: 'provisional' | 'validated';
  dimensions: Record<NodeQualityDimensionName, NodeQualityDimension>;
  warnings: string[];
}

const EPSILON = 1e-4;

function clamp01(value: number | undefined, fallback = 0): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}

function geometricMean(dimensions: readonly NodeQualityDimension[]): number {
  const applicable = dimensions.filter((item) => item.applicable && item.weight > 0);
  const totalWeight = applicable.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight <= 0) return 0;
  const logSum = applicable.reduce(
    (sum, item) => sum + item.weight * Math.log(Math.max(EPSILON, item.value)),
    0,
  );
  return Math.exp(logSum / totalWeight);
}

/**
 * Initial engineering quality score for weighting/diagnostics. It is NOT a
 * calibrated probability that a count is correct. A geometric mean is used so
 * one weak critical dimension cannot be hidden by several excellent ones.
 */
export function computeNodeQuality(input: NodeQualityInput): NodeQualityScore {
  const dimensions: Record<NodeQualityDimensionName, NodeQualityDimension> = {
    detection: { value: clamp01(input.detection), weight: 0.2, applicable: true },
    tracking: { value: clamp01(input.tracking), weight: 0.2, applicable: true },
    geometry: {
      value: clamp01(input.geometry),
      weight: 0.1,
      applicable: input.geometry !== undefined,
    },
    temporal: { value: clamp01(input.temporal), weight: 0.15, applicable: true },
    device: { value: clamp01(input.device), weight: 0.15, applicable: true },
    validation: {
      value: clamp01(input.validation),
      weight: 0.15,
      applicable: input.validation !== undefined,
    },
    consistency: {
      value: clamp01(input.consistency),
      weight: 0.05,
      applicable: input.consistency !== undefined,
    },
  };

  const warnings: string[] = [];
  let overall = geometricMean(Object.values(dimensions));

  if (dimensions.tracking.value < 0.3) {
    warnings.push('tracking_quality_critical');
    overall = Math.min(overall, 0.4);
  }
  if (dimensions.temporal.value < 0.3) {
    warnings.push('temporal_coverage_critical');
    overall = Math.min(overall, 0.4);
  }
  if (dimensions.device.value < 0.25) {
    warnings.push('device_stability_critical');
    overall = Math.min(overall, 0.35);
  }
  if (input.geometry !== undefined && dimensions.geometry.value < 0.3) {
    warnings.push('geometry_quality_critical');
  }
  if (input.validation === undefined) {
    warnings.push('ground_truth_validation_missing');
  }
  if (input.consistency === undefined) {
    warnings.push('network_consistency_not_estimated');
  }

  return {
    methodVersion: '0.1',
    overall: clamp01(overall),
    status: input.validation === undefined ? 'provisional' : 'validated',
    dimensions,
    warnings,
  };
}
