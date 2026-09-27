import { describe, expect, it } from 'vitest';
import type { RawDetection } from '../../src/core/types';
import type { GroundTruthObject } from '../../src/detection/benchmarkDataset';
import {
  boundingBoxIoU,
  evaluateDetectionsAgainstGroundTruth,
} from '../../src/detection/groundTruthMatching';

function detection(
  className: string,
  x: number,
  y: number,
  width: number,
  height: number,
  confidence = 0.9,
): RawDetection {
  return { classId: 0, className, confidence, bbox: { x, y, width, height } };
}

function truth(
  annotationId: string,
  className: string,
  x: number,
  y: number,
  width: number,
  height: number,
  extra: Partial<GroundTruthObject> = {},
): GroundTruthObject {
  return { annotationId, className, bbox: { x, y, width, height }, ...extra };
}

describe('detector ground-truth matching', () => {
  it('computes standard bounding-box IoU', () => {
    expect(boundingBoxIoU(
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 50, y: 0, width: 100, height: 100 },
    )).toBeCloseTo(1 / 3, 6);
  });

  it('uses global assignment so output order cannot steal a better match', () => {
    const groundTruth = [
      truth('a', 'person', 0, 0, 100, 100),
      truth('b', 'person', 80, 0, 100, 100),
    ];
    const detections = [
      detection('person', 40, 0, 100, 100),
      detection('person', 0, 0, 100, 100),
    ];

    const result = evaluateDetectionsAgainstGroundTruth(detections, groundTruth, 500, {
      iouThreshold: 0.4,
    });

    expect(result.matches).toHaveLength(2);
    expect(result.falsePositiveDetectionIndices).toEqual([]);
    expect(result.falseNegativeAnnotationIds).toEqual([]);
    expect(result.matches.find((match) => match.annotationId === 'a')?.detectionIndex).toBe(1);
    expect(result.matches.find((match) => match.annotationId === 'b')?.detectionIndex).toBe(0);
  });

  it('never matches detections across classes', () => {
    const result = evaluateDetectionsAgainstGroundTruth(
      [detection('bicycle', 0, 0, 100, 100)],
      [truth('p1', 'person', 0, 0, 100, 100)],
      500,
    );

    expect(result.matches).toHaveLength(0);
    expect(result.falsePositiveDetectionIndices).toEqual([0]);
    expect(result.falseNegativeAnnotationIds).toEqual(['p1']);
  });

  it('lets ignored annotations absorb detections without creating TP, FP or FN', () => {
    const result = evaluateDetectionsAgainstGroundTruth(
      [detection('person', 10, 10, 80, 80)],
      [truth('ambiguous', 'person', 10, 10, 80, 80, { ignore: true, occlusion: 'heavy' })],
      500,
    );

    expect(result.matches).toHaveLength(0);
    expect(result.ignoredDetectionIndices).toEqual([0]);
    expect(result.falsePositiveDetectionIndices).toEqual([]);
    expect(result.falseNegativeAnnotationIds).toEqual([]);
    expect(result.accuracyObservations).toEqual([]);
  });
});
