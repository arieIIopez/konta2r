import { describe, expect, it } from 'vitest';
import type { RawDetection } from '../../src/core/types';
import { fuseModalDetections } from '../../src/fusion/modalFusion';

function raw(
  className: string,
  x: number,
  y: number,
  width: number,
  height: number,
  confidence = 0.9,
): RawDetection {
  return {
    classId: 0,
    className,
    confidence,
    bbox: { x, y, width, height },
  };
}

describe('modal fusion', () => {
  it('emits one cyclist instead of pedestrian + bicycle for a clear rider pair', () => {
    const person = raw('person', 100, 50, 40, 100, 0.94);
    const bicycle = raw('bicycle', 80, 120, 100, 50, 0.91);

    const result = fuseModalDetections([person, bicycle]);

    expect(result.entities).toHaveLength(1);
    expect(result.entities[0]?.entityType).toBe('cyclist');
    expect(result.entities[0]?.sourceDetections).toHaveLength(2);
    expect(result.suppressedPersonIndices).toEqual([0]);
    expect(result.pairs).toHaveLength(1);
  });

  it('does not fuse a pedestrian who is merely near but geometrically separated from a bicycle', () => {
    const pedestrian = raw('person', 300, 50, 40, 100, 0.95);
    const bicycle = raw('bicycle', 80, 120, 100, 50, 0.93);

    const result = fuseModalDetections([pedestrian, bicycle]);

    expect(result.pairs).toHaveLength(0);
    expect(result.entities.map((item) => item.entityType)).toEqual(['pedestrian']);
    expect(result.ignoredDetectionIndices).toContain(1);
  });

  it('pairs two riders globally without consuming one person twice', () => {
    const detections = [
      raw('person', 95, 45, 42, 102),
      raw('person', 315, 48, 42, 102),
      raw('bicycle', 75, 118, 105, 52),
      raw('bicycle', 295, 120, 105, 52),
    ];

    const result = fuseModalDetections(detections);

    expect(result.pairs).toHaveLength(2);
    expect(result.entities.filter((item) => item.entityType === 'cyclist')).toHaveLength(2);
    expect(result.entities.filter((item) => item.entityType === 'pedestrian')).toHaveLength(0);
    expect(new Set(result.pairs.map((pair) => pair.personIndex)).size).toBe(2);
    expect(new Set(result.pairs.map((pair) => pair.rideableIndex)).size).toBe(2);
  });

  it('maps person + skateboard to one skater', () => {
    const result = fuseModalDetections([
      raw('person', 100, 50, 38, 100),
      raw('skateboard', 88, 140, 75, 18),
    ]);

    expect(result.entities).toHaveLength(1);
    expect(result.entities[0]?.entityType).toBe('skater');
  });

  it('keeps an unpaired motorcycle as motorcyclist to bridge rider detector misses', () => {
    const result = fuseModalDetections([
      raw('motorcycle', 100, 100, 90, 70, 0.88),
    ]);

    expect(result.entities).toHaveLength(1);
    expect(result.entities[0]?.entityType).toBe('motorcyclist');
  });

  it('does not promote an unpaired bicycle to cyclist in the stateless fusion layer', () => {
    const result = fuseModalDetections([
      raw('bicycle', 100, 100, 90, 60, 0.92),
    ]);

    expect(result.entities).toHaveLength(0);
    expect(result.ignoredDetectionIndices).toEqual([0]);
  });

  it('passes direct motor vehicles through as mobility entities', () => {
    const result = fuseModalDetections([
      raw('car', 10, 20, 120, 70),
      raw('bus', 200, 20, 220, 100),
      raw('truck', 450, 20, 200, 100),
    ]);

    expect(result.entities.map((item) => item.entityType)).toEqual(['car', 'bus', 'truck']);
  });

  it('filters low-confidence rider components before pairing', () => {
    const result = fuseModalDetections([
      raw('person', 100, 50, 40, 100, 0.2),
      raw('bicycle', 80, 120, 100, 50, 0.9),
    ]);

    expect(result.pairs).toHaveLength(0);
    expect(result.entities).toHaveLength(0);
    expect(result.ignoredDetectionIndices).toContain(0);
    expect(result.ignoredDetectionIndices).toContain(1);
  });
});
