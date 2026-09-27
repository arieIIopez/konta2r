import { describe, expect, it } from 'vitest';
import type { MobilityEntityObservation } from '../../src/core/types';
import { evaluateTrackingIdentity, type TrackingEvaluationFrame } from '../../src/tracking/evaluation';
import { MultiObjectTracker } from '../../src/tracking/multiObjectTracker';

interface LabeledDetection {
  gtId: string;
  detection: MobilityEntityObservation;
}

function labeled(gtId: string, x: number, confidence = 0.9): LabeledDetection {
  return {
    gtId,
    detection: {
      entityType: 'car',
      confidence,
      groundPoint: { x, y: 100 },
      bbox: { x: x - 10, y: 70, width: 20, height: 30 },
      sourceDetections: [],
    },
  };
}

function runV2(sequence: readonly LabeledDetection[][]): TrackingEvaluationFrame[] {
  const tracker = new MultiObjectTracker({
    confirmationHits: 1,
    maxDistancePx: 90,
    velocitySmoothing: 0.45,
    highConfidence: 0.7,
    lowConfidence: 0.2,
  });

  return sequence.map((frame, frameIndex) => {
    const result = tracker.update(frame.map((item) => item.detection), frameIndex * 100);
    const trackByDetection = new Map(result.matches.map((match) => [match.detectionIndex, match.trackId]));

    // First-frame detections create tracks after association, so infer their IDs from creation order.
    if (frameIndex === 0) {
      result.createdTrackIds.forEach((trackId, index) => trackByDetection.set(index, trackId));
    }

    return {
      groundTruth: frame.map((item) => ({ id: item.gtId })),
      matches: frame.flatMap((item, index) => {
        const trackId = trackByDetection.get(index);
        return trackId ? [{ groundTruthId: item.gtId, trackId }] : [];
      }),
    };
  });
}

interface GreedyTrack {
  id: string;
  x: number;
}

function runGreedyHighConfidenceOnly(sequence: readonly LabeledDetection[][]): TrackingEvaluationFrame[] {
  const tracks: GreedyTrack[] = [];
  let nextId = 1;

  return sequence.map((frame) => {
    const candidates = frame
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.detection.confidence >= 0.7);
    const unused = new Set(candidates.map(({ index }) => index));
    const matchByDetection = new Map<number, string>();

    for (const track of tracks) {
      let bestIndex: number | undefined;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const index of unused) {
        const candidate = frame[index];
        if (!candidate) continue;
        const distance = Math.abs(candidate.detection.groundPoint.x - track.x);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = index;
        }
      }
      if (bestIndex !== undefined && bestDistance <= 90) {
        const candidate = frame[bestIndex];
        if (candidate) {
          track.x = candidate.detection.groundPoint.x;
          matchByDetection.set(bestIndex, track.id);
          unused.delete(bestIndex);
        }
      }
    }

    for (const index of unused) {
      const candidate = frame[index];
      if (!candidate) continue;
      const track: GreedyTrack = { id: `g_${nextId}`, x: candidate.detection.groundPoint.x };
      nextId += 1;
      tracks.push(track);
      matchByDetection.set(index, track.id);
    }

    return {
      groundTruth: frame.map((item) => ({ id: item.gtId })),
      matches: frame.flatMap((item, index) => {
        const trackId = matchByDetection.get(index);
        return trackId ? [{ groundTruthId: item.gtId, trackId }] : [];
      }),
    };
  });
}

describe('synthetic tracker benchmark', () => {
  it('reduces identity switches when two objects cross', () => {
    const sequence = [
      [labeled('A', 0), labeled('B', 100)],
      [labeled('B', 70), labeled('A', 30)],
      [labeled('B', 40), labeled('A', 60)],
      [labeled('B', 10), labeled('A', 90)],
    ];

    const v2 = evaluateTrackingIdentity(runV2(sequence));
    const greedy = evaluateTrackingIdentity(runGreedyHighConfidenceOnly(sequence));

    expect(v2.idSwitches).toBe(0);
    expect(greedy.idSwitches).toBeGreaterThan(v2.idSwitches);
    expect(v2.idF1).toBeGreaterThan(greedy.idF1);
  });

  it('uses a low-confidence observation to avoid fragmentation and duplicate identity', () => {
    const sequence = [
      [labeled('A', 0, 0.95)],
      [labeled('A', 10, 0.92)],
      [labeled('A', 20, 0.35)],
      [labeled('A', 30, 0.94)],
    ];

    const v2 = evaluateTrackingIdentity(runV2(sequence));
    const greedy = evaluateTrackingIdentity(runGreedyHighConfidenceOnly(sequence));

    expect(v2.uniquePredictedTracks).toBe(1);
    expect(v2.fragmentations).toBe(0);
    expect(greedy.idRecall).toBeLessThan(v2.idRecall);
    expect(v2.idF1).toBeGreaterThan(greedy.idF1);
  });
});
