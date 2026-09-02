import { describe, expect, it } from 'vitest';
import {
  countingGeometryStreamId,
  countingLineSideLabels,
  createCountingGeometryConfiguration,
  normalizedVideoPointToViewport,
  operationalCountingLine,
  validateCountingGeometryConfiguration,
  videoCoverTransform,
  viewportPointToNormalizedVideo,
} from '../../src/node/countingGeometry';

describe('counting geometry configuration', () => {
  it('creates a stable id and increments revisions without changing normalized geometry', () => {
    const first = createCountingGeometryConfiguration({
      line: {
        id: 'line_primary',
        a: { x: 0.2, y: 0.3 },
        b: { x: 0.8, y: 0.7 },
      },
      frameWidth: 1920,
      frameHeight: 1080,
      nowEpochMs: 1_800_000_000_000,
      createId: () => 'geometry_test123',
    });
    const second = createCountingGeometryConfiguration({
      line: {
        id: 'line_primary',
        a: { x: 0.25, y: 0.35 },
        b: { x: 0.75, y: 0.65 },
      },
      frameWidth: 1280,
      frameHeight: 720,
      nowEpochMs: 1_800_000_001_000,
      previous: first,
    });

    expect(first.configurationId).toBe('geometry_test123');
    expect(first.revision).toBe(1);
    expect(second.configurationId).toBe(first.configurationId);
    expect(second.revision).toBe(2);
    expect(second.referenceFrame.aspectRatio).toBeCloseTo(16 / 9);
    expect(second.directionConvention).toEqual({
      sideA: 'LEFT_OF_A_TO_B',
      sideB: 'RIGHT_OF_A_TO_B',
      publicAToB: 'LEFT_TO_RIGHT',
      publicBToA: 'RIGHT_TO_LEFT',
    });
    expect(() => validateCountingGeometryConfiguration(second)).not.toThrow();
  });

  it('creates a distinct operational stream for every saved revision without mutating editor geometry', () => {
    const first = createCountingGeometryConfiguration({
      line: {
        id: 'line_primary',
        a: { x: 0.2, y: 0.3 },
        b: { x: 0.8, y: 0.7 },
      },
      frameWidth: 1920,
      frameHeight: 1080,
      nowEpochMs: 1_800_000_000_000,
      createId: () => 'geometry_test123',
    });
    const second = createCountingGeometryConfiguration({
      line: {
        id: 'line_primary',
        a: { x: 0.25, y: 0.35 },
        b: { x: 0.75, y: 0.65 },
      },
      frameWidth: 1920,
      frameHeight: 1080,
      nowEpochMs: 1_800_000_100_000,
      previous: first,
    });

    expect(countingGeometryStreamId(first)).toBe('geometry_test123_r1');
    expect(countingGeometryStreamId(second)).toBe('geometry_test123_r2');
    const operational = operationalCountingLine(second);
    expect(operational.id).toBe('geometry_test123_r2');
    expect(second.line.id).toBe('line_primary');

    operational.a.x = 0.99;
    expect(second.line.a.x).toBe(0.25);
  });

  it('rejects touch lines too short to be operationally meaningful', () => {
    expect(() => createCountingGeometryConfiguration({
      line: {
        id: 'line_primary',
        a: { x: 0.5, y: 0.5 },
        b: { x: 0.51, y: 0.51 },
      },
      frameWidth: 640,
      frameHeight: 360,
      createId: () => 'geometry_short1',
    })).toThrow(/too short/i);
  });
});

describe('object-fit cover coordinate mapping', () => {
  it('accounts for horizontal cropping when a 16:9 source fills a square viewport', () => {
    const transform = videoCoverTransform(1920, 1080, 400, 400);
    expect(transform.renderedHeight).toBeCloseTo(400);
    expect(transform.renderedWidth).toBeCloseTo(711.111, 2);
    expect(transform.offsetX).toBeLessThan(0);
    expect(transform.offsetY).toBeCloseTo(0);

    const center = viewportPointToNormalizedVideo({
      x: 200,
      y: 200,
      sourceWidth: 1920,
      sourceHeight: 1080,
      viewportWidth: 400,
      viewportHeight: 400,
    });
    expect(center.x).toBeCloseTo(0.5);
    expect(center.y).toBeCloseTo(0.5);

    const visibleLeft = viewportPointToNormalizedVideo({
      x: 0,
      y: 200,
      sourceWidth: 1920,
      sourceHeight: 1080,
      viewportWidth: 400,
      viewportHeight: 400,
    });
    expect(visibleLeft.x).toBeGreaterThan(0.2);
    expect(visibleLeft.x).toBeLessThan(0.23);
  });

  it('round-trips visible source points through the cover viewport', () => {
    const original = { x: 0.36, y: 0.72 };
    const viewport = normalizedVideoPointToViewport({
      point: original,
      sourceWidth: 1920,
      sourceHeight: 1080,
      viewportWidth: 390,
      viewportHeight: 600,
    });
    const recovered = viewportPointToNormalizedVideo({
      x: viewport.x,
      y: viewport.y,
      sourceWidth: 1920,
      sourceHeight: 1080,
      viewportWidth: 390,
      viewportHeight: 600,
    });
    expect(recovered.x).toBeCloseTo(original.x, 8);
    expect(recovered.y).toBeCloseTo(original.y, 8);
  });

  it('places side A on the left and side B on the right of the directed line', () => {
    const sides = countingLineSideLabels({
      id: 'line_primary',
      a: { x: 0.2, y: 0.5 },
      b: { x: 0.8, y: 0.5 },
    });
    expect(sides.sideA.y).toBeGreaterThan(0.5);
    expect(sides.sideB.y).toBeLessThan(0.5);
  });
});
