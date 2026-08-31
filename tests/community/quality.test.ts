import { describe, expect, it } from 'vitest';
import { computeNodeQuality } from '../../src/community/quality';

describe('community node quality', () => {
  it('marks a node provisional until ground-truth validation exists', () => {
    const score = computeNodeQuality({
      detection: 0.9,
      tracking: 0.9,
      temporal: 0.95,
      device: 0.9,
      geometry: 0.88,
    });

    expect(score.status).toBe('provisional');
    expect(score.warnings).toContain('ground_truth_validation_missing');
    expect(score.overall).toBeGreaterThan(0.8);
  });

  it('becomes validated when validation evidence is supplied', () => {
    const score = computeNodeQuality({
      detection: 0.9,
      tracking: 0.9,
      temporal: 0.95,
      device: 0.9,
      geometry: 0.88,
      validation: 0.87,
      consistency: 0.91,
    });

    expect(score.status).toBe('validated');
    expect(score.overall).toBeGreaterThan(0.8);
  });

  it('caps overall quality when tracking is critically weak', () => {
    const score = computeNodeQuality({
      detection: 0.95,
      tracking: 0.2,
      temporal: 0.98,
      device: 0.95,
      validation: 0.95,
    });

    expect(score.overall).toBeLessThanOrEqual(0.4);
    expect(score.warnings).toContain('tracking_quality_critical');
  });

  it('does not require geometry for a count-only node', () => {
    const score = computeNodeQuality({
      detection: 0.8,
      tracking: 0.85,
      temporal: 0.9,
      device: 0.9,
      validation: 0.82,
    });

    expect(score.dimensions.geometry.applicable).toBe(false);
    expect(score.overall).toBeGreaterThan(0.75);
  });
});
