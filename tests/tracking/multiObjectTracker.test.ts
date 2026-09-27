import { describe, expect, it } from 'vitest';
import type { MobilityEntityObservation } from '../../src/core/types';
import { MultiObjectTracker } from '../../src/tracking/multiObjectTracker';

function detection(
  x: number,
  confidence = 0.9,
  entityType: MobilityEntityObservation['entityType'] = 'car',
): MobilityEntityObservation {
  return {
    entityType,
    confidence,
    groundPoint: { x, y: 100 },
    bbox: { x: x - 10, y: 70, width: 20, height: 30 },
    sourceDetections: [],
  };
}

describe('MultiObjectTracker', () => {
  it('promotes a stable tentative track after repeated observations', () => {
    const tracker = new MultiObjectTracker({ confirmationHits: 3 });

    expect(tracker.update([detection(10)], 0).tracks[0]?.state).toBe('tentative');
    expect(tracker.update([detection(13)], 100).tracks[0]?.state).toBe('tentative');
    const result = tracker.update([detection(16)], 200);

    expect(result.tracks).toHaveLength(1);
    expect(result.tracks[0]?.state).toBe('confirmed');
    expect(result.tracks[0]?.id).toBe('t_1');
  });

  it('preserves identities when same-class objects cross', () => {
    const tracker = new MultiObjectTracker({
      confirmationHits: 1,
      maxDistancePx: 90,
      velocitySmoothing: 0.45,
    });

    tracker.update([detection(0), detection(100)], 0);
    tracker.update([detection(70), detection(30)], 100);
    tracker.update([detection(40), detection(60)], 200);
    const result = tracker.update([detection(10), detection(90)], 300);

    const t1 = result.tracks.find((track) => track.id === 't_1');
    const t2 = result.tracks.find((track) => track.id === 't_2');
    expect(t1?.samples.at(-1)?.point.x).toBe(90);
    expect(t2?.samples.at(-1)?.point.x).toBe(10);
  });

  it('uses low-confidence detections to bridge an occlusion without spawning a new track', () => {
    const tracker = new MultiObjectTracker({
      confirmationHits: 1,
      highConfidence: 0.7,
      lowConfidence: 0.2,
      maxDistancePx: 80,
    });

    tracker.update([detection(0, 0.95)], 0);
    tracker.update([detection(12, 0.92)], 100);
    const low = tracker.update([detection(24, 0.35)], 200);
    const recovered = tracker.update([detection(36, 0.93)], 300);

    expect(low.matches[0]?.stage).toBe('low');
    expect(low.createdTrackIds).toHaveLength(0);
    expect(recovered.tracks).toHaveLength(1);
    expect(recovered.tracks[0]?.id).toBe('t_1');
    expect(recovered.tracks[0]?.state).toBe('confirmed');
  });

  it('recovers a confirmed track after a short period with no detection', () => {
    const tracker = new MultiObjectTracker({
      confirmationHits: 1,
      maxLostMs: 1000,
      maxDistancePx: 100,
    });

    tracker.update([detection(0)], 0);
    tracker.update([detection(10)], 100);
    const lost = tracker.update([], 400);
    const recovered = tracker.update([detection(40)], 700);

    expect(lost.tracks[0]?.state).toBe('lost');
    expect(recovered.tracks[0]?.id).toBe('t_1');
    expect(recovered.tracks[0]?.state).toBe('confirmed');
  });

  it('removes tracks after the configured lost timeout', () => {
    const tracker = new MultiObjectTracker({ confirmationHits: 1, maxLostMs: 500 });

    tracker.update([detection(0)], 0);
    tracker.update([], 100);
    const result = tracker.update([], 700);

    expect(result.removedTrackIds).toContain('t_1');
    expect(result.tracks).toHaveLength(0);
  });

  it('never associates a detection with a different mobility entity type', () => {
    const tracker = new MultiObjectTracker({ confirmationHits: 1 });

    tracker.update([detection(0, 0.9, 'car')], 0);
    const result = tracker.update([detection(2, 0.9, 'cyclist')], 100);

    const car = result.tracks.find((track) => track.entityType === 'car');
    const cyclist = result.tracks.find((track) => track.entityType === 'cyclist');
    expect(car?.state).toBe('lost');
    expect(cyclist?.id).toBe('t_2');
  });
});
