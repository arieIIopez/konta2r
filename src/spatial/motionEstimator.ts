import type { MetricPoint2D } from './types';

export interface TimedMetricPoint {
  timestampMs: number;
  position: MetricPoint2D;
}

export interface MotionEstimateOptions {
  minWindowMs?: number;
  maxWindowMs?: number;
  maxSegmentSpeedMps?: number;
}

export interface MotionEstimate {
  speedMps?: number;
  headingDegrees?: number;
  motionQuality: number;
  sampleCount: number;
  durationMs: number;
  rejectedSegments: number;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function median(values: readonly number[]): number | undefined {
  if (values.length === 0) {
    return undefined;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }
  const left = sorted[middle - 1];
  const right = sorted[middle];
  return left === undefined || right === undefined ? undefined : (left + right) / 2;
}

function headingFromDelta(dx: number, dy: number): number | undefined {
  if (Math.hypot(dx, dy) < 1e-6) {
    return undefined;
  }
  // Clockwise from north: north=0, east=90.
  return (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
}

/**
 * Robust local kinematics from already-calibrated metric positions.
 * Uses median segment speed and net-displacement heading; it intentionally
 * avoids acceleration until calibration/tracking quality is sufficiently known.
 */
export function estimateMotion(
  samples: readonly TimedMetricPoint[],
  options: MotionEstimateOptions = {},
): MotionEstimate {
  if (samples.length < 2) {
    return {
      motionQuality: 0,
      sampleCount: samples.length,
      durationMs: 0,
      rejectedSegments: 0,
    };
  }

  const ordered = [...samples].sort((a, b) => a.timestampMs - b.timestampMs);
  const maxWindowMs = options.maxWindowMs ?? 3000;
  const latest = ordered.at(-1);
  if (!latest) {
    return { motionQuality: 0, sampleCount: 0, durationMs: 0, rejectedSegments: 0 };
  }
  const recent = ordered.filter((sample) => latest.timestampMs - sample.timestampMs <= maxWindowMs);
  if (recent.length < 2) {
    return { motionQuality: 0, sampleCount: recent.length, durationMs: 0, rejectedSegments: 0 };
  }

  const minWindowMs = options.minWindowMs ?? 500;
  const maxSegmentSpeedMps = options.maxSegmentSpeedMps ?? 55;
  const segmentSpeeds: number[] = [];
  let rejectedSegments = 0;

  for (let index = 1; index < recent.length; index += 1) {
    const previous = recent[index - 1];
    const current = recent[index];
    if (!previous || !current) {
      continue;
    }
    const dt = (current.timestampMs - previous.timestampMs) / 1000;
    if (!(dt > 0)) {
      rejectedSegments += 1;
      continue;
    }
    const distance = Math.hypot(
      current.position.xMeters - previous.position.xMeters,
      current.position.yMeters - previous.position.yMeters,
    );
    const speed = distance / dt;
    if (!Number.isFinite(speed) || speed > maxSegmentSpeedMps) {
      rejectedSegments += 1;
      continue;
    }
    segmentSpeeds.push(speed);
  }

  const first = recent[0];
  const last = recent.at(-1);
  if (!first || !last) {
    return { motionQuality: 0, sampleCount: recent.length, durationMs: 0, rejectedSegments };
  }

  const durationMs = Math.max(0, last.timestampMs - first.timestampMs);
  const speedMps = median(segmentSpeeds);
  const headingDegrees = headingFromDelta(
    last.position.xMeters - first.position.xMeters,
    last.position.yMeters - first.position.yMeters,
  );

  const validRatio = segmentSpeeds.length / Math.max(1, recent.length - 1);
  const durationScore = clamp01(durationMs / Math.max(1, minWindowMs));
  const sampleScore = clamp01((recent.length - 1) / 5);

  let consistencyScore = 0;
  if (speedMps !== undefined && segmentSpeeds.length > 0) {
    const deviations = segmentSpeeds.map((speed) => Math.abs(speed - speedMps));
    const mad = median(deviations) ?? 0;
    consistencyScore = Math.exp(-mad / Math.max(0.5, speedMps * 0.35));
  }

  const motionQuality = clamp01(
    0.30 * validRatio + 0.25 * durationScore + 0.20 * sampleScore + 0.25 * consistencyScore,
  );

  return {
    ...(speedMps === undefined ? {} : { speedMps }),
    ...(headingDegrees === undefined ? {} : { headingDegrees }),
    motionQuality,
    sampleCount: recent.length,
    durationMs,
    rejectedSegments,
  };
}
