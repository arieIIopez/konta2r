import { describe, expect, it } from 'vitest';
import {
  RelationSamplingGate,
  relationSamplingConfigForProfile,
} from '../../src/relations/samplingGate';
import type { RelationCandidate, RelationEndpoint } from '../../src/relations/types';

function endpoint(
  id: string,
  x: number,
  kind: RelationEndpoint['kind'] = 'track',
): RelationEndpoint {
  return {
    id,
    kind,
    ...(kind === 'track' ? { entityType: 'pedestrian' as const } : { elementType: 'bench' }),
    bbox: { x, y: 0, width: 40, height: 80 },
    confidence: 0.9,
  };
}

function candidate(
  subjectId = 't_1',
  objectId = 'bench_1',
  priority = 0.8,
  subjectX = 0,
  objectX = 50,
): RelationCandidate {
  return {
    subject: endpoint(subjectId, subjectX),
    object: endpoint(objectId, objectX, 'static_element'),
    priority,
    reason: 'spatial_proximity',
  };
}

describe('relation temporal sampling gate', () => {
  it('selects a new pair immediately', () => {
    const gate = new RelationSamplingGate({ minIntervalMs: 1_000 });
    const plan = gate.plan([candidate()], 0);

    expect(plan.selected).toHaveLength(1);
    expect(plan.selected[0]?.reason).toBe('new_pair');
  });

  it('does not start the interval until a completed evaluation is recorded', () => {
    const gate = new RelationSamplingGate({ minIntervalMs: 1_000 });
    const first = gate.plan([candidate()], 0);

    const retry = gate.plan([candidate()], 100);
    expect(retry.selected[0]?.reason).toBe('new_pair');

    gate.recordEvaluation(first.selected, 100);
    expect(gate.plan([candidate()], 200).selected).toEqual([]);
  });

  it('re-evaluates a stable pair after the configured interval', () => {
    const gate = new RelationSamplingGate({ minIntervalMs: 1_000 });
    const first = gate.plan([candidate()], 0);
    gate.recordEvaluation(first.selected, 0);

    expect(gate.plan([candidate()], 999).selected).toEqual([]);
    expect(gate.plan([candidate()], 1_000).selected[0]?.reason).toBe('interval_elapsed');
  });

  it('forces early re-evaluation when endpoint geometry changes materially', () => {
    const gate = new RelationSamplingGate({
      minIntervalMs: 10_000,
      geometryChangeThreshold: 0.2,
    });
    const first = gate.plan([candidate()], 0);
    gate.recordEvaluation(first.selected, 0);

    const changed = candidate('t_1', 'bench_1', 0.8, 100, 50);
    const plan = gate.plan([changed], 100);

    expect(plan.selected[0]?.reason).toBe('geometry_changed');
    expect(plan.selected[0]?.geometryChange).toBeGreaterThanOrEqual(0.2);
  });

  it('forces early re-evaluation when candidate priority changes materially', () => {
    const gate = new RelationSamplingGate({
      minIntervalMs: 10_000,
      geometryChangeThreshold: 10,
      priorityDeltaThreshold: 0.2,
    });
    const first = gate.plan([candidate('t_1', 'bench_1', 0.4)], 0);
    gate.recordEvaluation(first.selected, 0);

    const plan = gate.plan([candidate('t_1', 'bench_1', 0.8)], 100);
    expect(plan.selected[0]?.reason).toBe('priority_changed');
  });

  it('applies a deterministic pair budget by candidate priority', () => {
    const gate = new RelationSamplingGate({ maxPairsPerEvaluation: 2 });
    const plan = gate.plan([
      candidate('t_1', 'bench_1', 0.4),
      candidate('t_2', 'bench_2', 0.9),
      candidate('t_3', 'bench_3', 0.7),
    ], 0);

    expect(plan.selected.map((item) => item.candidate.subject.id)).toEqual(['t_2', 't_3']);
    expect(plan.budgetDeferredCount).toBe(1);
  });

  it('treats profile values as explicit experimental hints', () => {
    const eco = relationSamplingConfigForProfile('eco');
    const performance = relationSamplingConfigForProfile('performance');

    expect(eco.minIntervalMs).toBeGreaterThan(performance.minIntervalMs);
    expect(eco.maxPairsPerEvaluation).toBeLessThan(performance.maxPairsPerEvaluation);
  });
});
