import { describe, expect, it } from 'vitest';
import type { DirectedLine } from '../../src/core/types';
import { LineCrossingDetector } from '../../src/spatial-events/line-crossing';

const line: DirectedLine = {
  id: 'screenline',
  a: { x: 0, y: 0 },
  b: { x: 0, y: 10 },
};

describe('LineCrossingDetector', () => {
  it('uses the last stable side through deadzone samples', () => {
    const detector = new LineCrossingDetector(line, {
      deadzone: 1,
      minCrossingIntervalMs: 0,
    });

    expect(
      detector.update({
        trackId: 't1',
        timestampMs: 0,
        point: { x: -5, y: 5 },
        confidence: 0.9,
      }),
    ).toBeNull();

    expect(
      detector.update({
        trackId: 't1',
        timestampMs: 100,
        point: { x: -0.2, y: 5 },
        confidence: 0.8,
      }),
    ).toBeNull();

    const crossing = detector.update({
      trackId: 't1',
      timestampMs: 200,
      point: { x: 5, y: 5 },
      confidence: 0.85,
    });

    expect(crossing?.direction).toBe('LEFT_TO_RIGHT');
    expect(crossing?.crossingPoint).toEqual({ x: 0, y: 5 });
    expect(crossing?.timestampMs).toBe(100);
  });

  it('does not emit an event outside the finite counting segment', () => {
    const detector = new LineCrossingDetector(line, {
      deadzone: 1,
      minCrossingIntervalMs: 0,
    });

    detector.update({
      trackId: 't2',
      timestampMs: 0,
      point: { x: -5, y: 20 },
      confidence: 0.9,
    });

    expect(
      detector.update({
        trackId: 't2',
        timestampMs: 100,
        point: { x: 5, y: 20 },
        confidence: 0.9,
      }),
    ).toBeNull();
  });

  it('suppresses immediate recrossing caused by oscillation', () => {
    const detector = new LineCrossingDetector(line, {
      deadzone: 1,
      minCrossingIntervalMs: 1000,
    });

    detector.update({
      trackId: 't3',
      timestampMs: 0,
      point: { x: -5, y: 5 },
      confidence: 0.9,
    });

    const first = detector.update({
      trackId: 't3',
      timestampMs: 200,
      point: { x: 5, y: 5 },
      confidence: 0.9,
    });
    expect(first).not.toBeNull();

    const jitterBack = detector.update({
      trackId: 't3',
      timestampMs: 300,
      point: { x: -5, y: 5 },
      confidence: 0.9,
    });
    expect(jitterBack).toBeNull();

    const laterCrossing = detector.update({
      trackId: 't3',
      timestampMs: 1500,
      point: { x: 5, y: 5 },
      confidence: 0.9,
    });
    expect(laterCrossing).not.toBeNull();
  });
});
