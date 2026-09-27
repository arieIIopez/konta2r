import { describe, expect, it } from 'vitest';
import { selectRelationCandidates } from '../../src/relations/candidateGate';
import type { RelationEndpoint } from '../../src/relations/types';

function endpoint(
  id: string,
  kind: RelationEndpoint['kind'],
  x: number,
  y: number,
  entityType?: RelationEndpoint['entityType'],
): RelationEndpoint {
  return {
    id,
    kind,
    bbox: { x, y, width: 40, height: 80 },
    ...(entityType === undefined ? {} : { entityType }),
    ...(kind === 'static_element' ? { elementType: 'bench' } : {}),
    confidence: 0.9,
  };
}

describe('relation candidate gate', () => {
  it('selects nearby person-to-static pairs without treating proximity as a relation', () => {
    const person = endpoint('t_1', 'track', 100, 100, 'pedestrian');
    const bench = endpoint('bench_1', 'static_element', 130, 130);

    const result = selectRelationCandidates([person, bench]);

    expect(result).toHaveLength(1);
    expect(result[0]?.subject.id).toBe('t_1');
    expect(result[0]?.object.id).toBe('bench_1');
    expect(result[0]?.reason).toBe('spatial_proximity');
    expect(result[0]?.priority).toBeGreaterThan(0);
  });

  it('rejects distant pairs before expensive semantic inference', () => {
    const person = endpoint('t_1', 'track', 0, 0, 'pedestrian');
    const bench = endpoint('bench_1', 'static_element', 1000, 1000);

    expect(selectRelationCandidates([person, bench])).toEqual([]);
  });

  it('creates directed person-to-person candidates for nearby tracks', () => {
    const a = endpoint('t_1', 'track', 100, 100, 'pedestrian');
    const b = endpoint('t_2', 'track', 125, 105, 'pedestrian');

    const result = selectRelationCandidates([a, b]);

    expect(result.map((item) => [item.subject.id, item.object.id])).toEqual([
      ['t_1', 't_2'],
      ['t_2', 't_1'],
    ]);
  });

  it('does not use cars as Public Life relation subjects by default', () => {
    const car = endpoint('t_car', 'track', 100, 100, 'car');
    const bench = endpoint('bench_1', 'static_element', 120, 120);

    expect(selectRelationCandidates([car, bench])).toEqual([]);
  });

  it('respects the candidate budget', () => {
    const person = endpoint('t_1', 'track', 100, 100, 'pedestrian');
    const elements = Array.from({ length: 5 }, (_, index) =>
      endpoint(`bench_${index}`, 'static_element', 105 + index, 105 + index),
    );

    const result = selectRelationCandidates([person, ...elements], {
      maxCandidates: 2,
    });

    expect(result).toHaveLength(2);
  });
});
