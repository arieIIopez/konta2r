import { describe, expect, it } from 'vitest';
import {
  createTemporalSamplingPlan,
  validateTemporalSamplingPlan,
} from '../../src/detection/temporalSampling';

describe('temporal sampling', () => {
  it('is exactly reproducible from the same seed and configuration', () => {
    const options = {
      durationMs: 120_000,
      sampleCount: 12,
      seed: 'pilot-rm-001',
      startMarginMs: 2_000,
      endMarginMs: 3_000,
      jitterFraction: 0.6,
    } as const;

    const first = createTemporalSamplingPlan(options);
    const second = createTemporalSamplingPlan(options);
    expect(second).toEqual(first);
    expect(() => validateTemporalSamplingPlan(first)).not.toThrow();
  });

  it('places one sample inside each temporal stratum', () => {
    const plan = createTemporalSamplingPlan({
      durationMs: 100_000,
      sampleCount: 10,
      seed: 'strata',
      startMarginMs: 5_000,
      endMarginMs: 5_000,
      jitterFraction: 1,
    });

    const usableStart = 5_000;
    const stratumWidth = 9_000;
    expect(plan.plannedMediaTimesMs).toHaveLength(10);
    plan.plannedMediaTimesMs.forEach((time, index) => {
      const start = usableStart + index * stratumWidth;
      const end = start + stratumWidth;
      expect(time).toBeGreaterThanOrEqual(start);
      expect(time).toBeLessThanOrEqual(end);
      if (index > 0) expect(time).toBeGreaterThanOrEqual(plan.plannedMediaTimesMs[index - 1] ?? 0);
    });
  });

  it('uses stratum centers when jitter is zero', () => {
    const plan = createTemporalSamplingPlan({
      durationMs: 40_000,
      sampleCount: 4,
      seed: 'centers',
      jitterFraction: 0,
    });
    expect(plan.plannedMediaTimesMs).toEqual([5_000, 15_000, 25_000, 35_000]);
  });

  it('changes the sample when the seed changes without changing the declared design', () => {
    const a = createTemporalSamplingPlan({ durationMs: 60_000, sampleCount: 6, seed: 'a' });
    const b = createTemporalSamplingPlan({ durationMs: 60_000, sampleCount: 6, seed: 'b' });
    expect(a.plannedMediaTimesMs).not.toEqual(b.plannedMediaTimesMs);
    expect(a.strategy).toBe(b.strategy);
    expect(a.sampleCount).toBe(b.sampleCount);
  });

  it('detects a tampered persisted sampling plan', () => {
    const plan = createTemporalSamplingPlan({ durationMs: 60_000, sampleCount: 6, seed: 'audit' });
    plan.plannedMediaTimesMs[2] = (plan.plannedMediaTimesMs[2] ?? 0) + 1;
    expect(() => validateTemporalSamplingPlan(plan)).toThrow('not reproducible');
  });

  it('rejects empty intervals and invalid configuration', () => {
    expect(() => createTemporalSamplingPlan({ durationMs: 0, sampleCount: 5, seed: 'x' })).toThrow();
    expect(() => createTemporalSamplingPlan({ durationMs: 10_000, sampleCount: 0, seed: 'x' })).toThrow();
    expect(() => createTemporalSamplingPlan({ durationMs: 10_000, sampleCount: 5, seed: '' })).toThrow();
    expect(() => createTemporalSamplingPlan({
      durationMs: 10_000,
      sampleCount: 5,
      seed: 'x',
      startMarginMs: 5_000,
      endMarginMs: 5_000,
    })).toThrow('leave no usable');
  });
});
