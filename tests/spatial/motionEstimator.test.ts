import { describe, expect, it } from 'vitest';
import { estimateMotion } from '../../src/spatial/motionEstimator';

describe('metric motion estimator', () => {
  it('estimates eastbound speed and heading from calibrated points', () => {
    const estimate = estimateMotion([
      { timestampMs: 0, position: { xMeters: 0, yMeters: 0 } },
      { timestampMs: 500, position: { xMeters: 2, yMeters: 0 } },
      { timestampMs: 1000, position: { xMeters: 4, yMeters: 0 } },
      { timestampMs: 1500, position: { xMeters: 6, yMeters: 0 } },
    ]);

    expect(estimate.speedMps).toBeCloseTo(4);
    expect(estimate.headingDegrees).toBeCloseTo(90);
    expect(estimate.motionQuality).toBeGreaterThan(0.7);
  });

  it('rejects an implausible teleport segment without poisoning median speed', () => {
    const estimate = estimateMotion([
      { timestampMs: 0, position: { xMeters: 0, yMeters: 0 } },
      { timestampMs: 500, position: { xMeters: 2, yMeters: 0 } },
      { timestampMs: 1000, position: { xMeters: 102, yMeters: 0 } },
      { timestampMs: 1500, position: { xMeters: 104, yMeters: 0 } },
    ], { maxSegmentSpeedMps: 20 });

    expect(estimate.speedMps).toBeCloseTo(4);
    expect(estimate.rejectedSegments).toBe(1);
    expect(estimate.motionQuality).toBeLessThan(1);
  });

  it('does not invent kinematics from a single point', () => {
    const estimate = estimateMotion([
      { timestampMs: 1000, position: { xMeters: 1, yMeters: 1 } },
    ]);

    expect(estimate.speedMps).toBeUndefined();
    expect(estimate.headingDegrees).toBeUndefined();
    expect(estimate.motionQuality).toBe(0);
  });
});
