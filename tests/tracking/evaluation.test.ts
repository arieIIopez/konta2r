import { describe, expect, it } from 'vitest';
import { evaluateTrackingIdentity } from '../../src/tracking/evaluation';

describe('tracking identity evaluation', () => {
  it('reports perfect identity metrics for a perfect sequence', () => {
    const metrics = evaluateTrackingIdentity([
      {
        groundTruth: [{ id: 'g1' }, { id: 'g2' }],
        matches: [
          { groundTruthId: 'g1', trackId: 't1' },
          { groundTruthId: 'g2', trackId: 't2' },
        ],
      },
      {
        groundTruth: [{ id: 'g1' }, { id: 'g2' }],
        matches: [
          { groundTruthId: 'g1', trackId: 't1' },
          { groundTruthId: 'g2', trackId: 't2' },
        ],
      },
    ]);

    expect(metrics.idF1).toBe(1);
    expect(metrics.idSwitches).toBe(0);
    expect(metrics.fragmentations).toBe(0);
    expect(metrics.uniqueCountError).toBe(0);
  });

  it('detects an identity switch and the resulting unique overcount', () => {
    const metrics = evaluateTrackingIdentity([
      {
        groundTruth: [{ id: 'g1' }],
        matches: [{ groundTruthId: 'g1', trackId: 't1' }],
      },
      {
        groundTruth: [{ id: 'g1' }],
        matches: [{ groundTruthId: 'g1', trackId: 't2' }],
      },
    ]);

    expect(metrics.idSwitches).toBe(1);
    expect(metrics.uniqueGroundTruthObjects).toBe(1);
    expect(metrics.uniquePredictedTracks).toBe(2);
    expect(metrics.uniqueCountError).toBe(1);
    expect(metrics.idF1).toBeLessThan(1);
  });

  it('counts a fragmentation when a matched object disappears and returns', () => {
    const metrics = evaluateTrackingIdentity([
      {
        groundTruth: [{ id: 'g1' }],
        matches: [{ groundTruthId: 'g1', trackId: 't1' }],
      },
      {
        groundTruth: [{ id: 'g1' }],
        matches: [],
      },
      {
        groundTruth: [{ id: 'g1' }],
        matches: [{ groundTruthId: 'g1', trackId: 't1' }],
      },
    ]);

    expect(metrics.fragmentations).toBe(1);
    expect(metrics.idSwitches).toBe(0);
    expect(metrics.idRecall).toBeLessThan(1);
  });

  it('penalizes unmatched predicted tracks as identity false positives', () => {
    const metrics = evaluateTrackingIdentity([
      {
        groundTruth: [{ id: 'g1' }],
        matches: [{ groundTruthId: 'g1', trackId: 't1' }],
        unmatchedPredictedTrackIds: ['false_1'],
      },
    ]);

    expect(metrics.idFalsePositives).toBe(1);
    expect(metrics.idPrecision).toBe(0.5);
  });
});
