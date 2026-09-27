import { describe, expect, it } from 'vitest';
import { metricToCanvas } from '../../src/spatial/syntheticTwin2d';

describe('Synthetic Twin 2D', () => {
  it('maps metric coordinates around a viewport center', () => {
    const point = metricToCanvas(
      { xMeters: 12, yMeters: 8 },
      {
        center: { xMeters: 10, yMeters: 10 },
        pixelsPerMeter: 20,
      },
      400,
      300,
    );

    expect(point.x).toBeCloseTo(240);
    expect(point.y).toBeCloseTo(190);
  });

  it('supports map rotation without requiring camera pixels', () => {
    const point = metricToCanvas(
      { xMeters: 11, yMeters: 10 },
      {
        center: { xMeters: 10, yMeters: 10 },
        pixelsPerMeter: 10,
        rotationDegrees: 90,
      },
      200,
      200,
    );

    expect(point.x).toBeCloseTo(100);
    expect(point.y).toBeCloseTo(110);
  });

  it('rejects an invalid visual scale', () => {
    expect(() => metricToCanvas(
      { xMeters: 0, yMeters: 0 },
      { center: { xMeters: 0, yMeters: 0 }, pixelsPerMeter: 0 },
      100,
      100,
    )).toThrow(/greater than zero/);
  });
});
