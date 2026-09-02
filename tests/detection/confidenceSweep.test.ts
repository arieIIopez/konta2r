import { describe, expect, it } from 'vitest';
import type { RawDetection } from '../../src/core/types';
import type { AnnotatedBenchmarkFrame } from '../../src/detection/benchmarkDataset';
import { ConfidenceSweepAccumulator } from '../../src/detection/confidenceSweep';

const frame: AnnotatedBenchmarkFrame = {
  frameId: 'f1',
  timestampMs: 1_000,
  width: 1_000,
  height: 500,
  objects: [{
    annotationId: 'person-1',
    className: 'person',
    bbox: { x: 100, y: 50, width: 200, height: 300 },
    occlusion: 'none',
  }],
};

const detections: RawDetection[] = [
  {
    classId: 1,
    className: 'person',
    confidence: 0.90,
    bbox: { x: 100, y: 50, width: 200, height: 300 },
  },
  {
    classId: 1,
    className: 'person',
    confidence: 0.20,
    bbox: { x: 700, y: 50, width: 120, height: 260 },
  },
];

describe('confidence sweep', () => {
  it('reuses detections to expose precision/recall changes across thresholds', () => {
    const sweep = new ConfidenceSweepAccumulator({ thresholds: [0.10, 0.50, 0.95], iouThreshold: 0.5 });
    sweep.addFrame(frame, detections);
    const result = sweep.finalize();

    expect(result.thresholds).toEqual([0.1, 0.5, 0.95]);
    expect(result.points[0]?.classMetrics[0]).toMatchObject({
      className: 'person',
      truePositive: 1,
      falsePositive: 1,
      falseNegative: 0,
      precision: 0.5,
      recall: 1,
    });
    expect(result.points[1]?.classMetrics[0]).toMatchObject({
      truePositive: 1,
      falsePositive: 0,
      falseNegative: 0,
      precision: 1,
      recall: 1,
      f1: 1,
    });
    expect(result.points[2]?.classMetrics[0]).toMatchObject({
      truePositive: 0,
      falsePositive: 0,
      falseNegative: 1,
      precision: 0,
      recall: 0,
      f1: 0,
    });
    expect(result.bestObservedMacroF1).toEqual({ threshold: 0.5, macroF1: 1 });
    expect(result.bestObservedByClass).toEqual([expect.objectContaining({
      className: 'person', threshold: 0.5, f1: 1,
    })]);
  });

  it('sorts and deduplicates thresholds deterministically', () => {
    const sweep = new ConfidenceSweepAccumulator({ thresholds: [0.8, 0.2, 0.8, 0.5] });
    expect(sweep.finalize().thresholds).toEqual([0.2, 0.5, 0.8]);
    expect(sweep.minimumThreshold()).toBe(0.2);
  });

  it('rejects empty and out-of-range threshold grids', () => {
    expect(() => new ConfidenceSweepAccumulator({ thresholds: [] })).toThrow('at least one threshold');
    expect(() => new ConfidenceSweepAccumulator({ thresholds: [-0.01, 0.5] })).toThrow('within [0, 1]');
    expect(() => new ConfidenceSweepAccumulator({ thresholds: [0.5], iouThreshold: 0 })).toThrow('IoU threshold');
  });

  it('uses a conservative higher threshold when observed F1 ties', () => {
    const sweep = new ConfidenceSweepAccumulator({ thresholds: [0.5, 0.8] });
    sweep.addFrame(frame, [detections[0] as RawDetection]);
    const result = sweep.finalize();
    expect(result.bestObservedMacroF1).toEqual({ threshold: 0.8, macroF1: 1 });
    expect(result.bestObservedByClass[0]?.threshold).toBe(0.8);
  });
});
