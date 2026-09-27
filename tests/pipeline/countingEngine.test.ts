import { describe, expect, it } from 'vitest';
import type { TrackState } from '../../src/core/types';
import { TrackCountingEngine } from '../../src/pipeline/countingEngine';
import type { TrackedEntity, TrackerUpdateResult } from '../../src/tracking/multiObjectTracker';

function track(
  id: string,
  state: TrackState,
  timestampMs: number,
  x: number,
  y: number,
  previousSamples: TrackedEntity['samples'] = [],
): TrackedEntity {
  const sample = {
    timestampMs,
    point: { x, y },
    bbox: { x: x - 10, y: y - 20, width: 20, height: 20 },
    confidence: 0.95,
  };
  return {
    id,
    entityType: 'cyclist',
    state,
    createdAtMs: previousSamples[0]?.timestampMs ?? timestampMs,
    updatedAtMs: timestampMs,
    samples: [...previousSamples, sample],
    hits: previousSamples.length + 1,
    totalMisses: 0,
    consecutiveMisses: 0,
    velocity: { xPxPerMs: 0, yPxPerMs: 0 },
    quality: 0.92,
    lastObservationConfidence: 0.95,
  };
}

function updateResult(entity: TrackedEntity, removedTrackIds: string[] = []): TrackerUpdateResult {
  return {
    tracks: [entity],
    confirmedTracks: entity.state === 'confirmed' ? [entity] : [],
    matches: [],
    createdTrackIds: [],
    removedTrackIds,
  };
}

const verticalLine = {
  id: 'line_main',
  a: { x: 0.5, y: 0.1 },
  b: { x: 0.5, y: 0.9 },
};

describe('track counting engine', () => {
  it('emits a crossing after a tentative candidate becomes confirmed', () => {
    const engine = new TrackCountingEngine([verticalLine], {
      deadzoneRelativeToFrameHeight: 0.002,
      pendingConfirmationMs: 1000,
    });

    const first = track('t1', 'tentative', 1000, 1280 * 0.4, 720 * 0.5);
    expect(engine.update(updateResult(first), 1280, 720, 1000, 's1')).toEqual([]);

    const second = track('t1', 'tentative', 1200, 1280 * 0.6, 720 * 0.5, first.samples);
    expect(engine.update(updateResult(second), 1280, 720, 1200, 's1')).toEqual([]);

    const third = track('t1', 'confirmed', 1400, 1280 * 0.65, 720 * 0.5, second.samples);
    const events = engine.update(updateResult(third), 1280, 720, 1400, 's1');

    expect(events).toHaveLength(1);
    expect(events[0]?.entityType).toBe('cyclist');
    expect(events[0]?.direction).toBe('LEFT_TO_RIGHT');
    expect(events[0]?.crossingPointSpace).toBe('normalized_image');
    expect(events[0]?.crossingPoint.x).toBeCloseTo(0.5, 6);
    expect(events[0]?.crossingPoint.y).toBeCloseTo(0.5, 6);
  });

  it('preserves the physical counting line across same-aspect profile resolution changes', () => {
    const engine = new TrackCountingEngine([verticalLine], {
      deadzoneRelativeToFrameHeight: 0.002,
    });

    const high = track('t2', 'confirmed', 1000, 1280 * 0.4, 720 * 0.5);
    expect(engine.update(updateResult(high), 1280, 720, 1000, 's2')).toEqual([]);

    const low = track('t2', 'confirmed', 1200, 640 * 0.6, 360 * 0.5, high.samples);
    const events = engine.update(updateResult(low), 640, 360, 1200, 's2');

    expect(events).toHaveLength(1);
    expect(events[0]?.crossingPoint.x).toBeCloseTo(0.5, 6);
  });

  it('resets crossing state when aspect ratio changes materially', () => {
    const engine = new TrackCountingEngine([verticalLine], {
      deadzoneRelativeToFrameHeight: 0.002,
      maxAspectRatioDrift: 0.01,
    });

    const wide = track('t3', 'confirmed', 1000, 1280 * 0.4, 720 * 0.5);
    expect(engine.update(updateResult(wide), 1280, 720, 1000, 's3')).toEqual([]);

    const squareish = track('t3', 'confirmed', 1200, 640 * 0.6, 480 * 0.5, wide.samples);
    expect(engine.update(updateResult(squareish), 640, 480, 1200, 's3')).toEqual([]);
  });

  it('drops pending crossings when a track is removed', () => {
    const engine = new TrackCountingEngine([verticalLine], {
      deadzoneRelativeToFrameHeight: 0.002,
      pendingConfirmationMs: 2000,
    });

    const first = track('t4', 'tentative', 1000, 1280 * 0.4, 720 * 0.5);
    engine.update(updateResult(first), 1280, 720, 1000, 's4');
    const crossed = track('t4', 'tentative', 1200, 1280 * 0.6, 720 * 0.5, first.samples);
    engine.update(updateResult(crossed), 1280, 720, 1200, 's4');

    const removedResult: TrackerUpdateResult = {
      tracks: [],
      confirmedTracks: [],
      matches: [],
      createdTrackIds: [],
      removedTrackIds: ['t4'],
    };
    expect(engine.update(removedResult, 1280, 720, 1300, 's4')).toEqual([]);
  });
});
