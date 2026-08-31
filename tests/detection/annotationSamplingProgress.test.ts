import { describe, expect, it } from 'vitest';
import {
  addAnnotationFrame,
  createAnnotationDraft,
  setAnnotationSamplingPlan,
} from '../../src/detection/annotationDraft';
import {
  getAnnotationSamplingProgress,
  plannedSelectionForIndex,
} from '../../src/detection/annotationSampling';
import { createTemporalSamplingPlan } from '../../src/detection/temporalSampling';

function plan() {
  return createTemporalSamplingPlan({ durationMs: 30_000, sampleCount: 3, seed: 'progress', jitterFraction: 0 });
}

describe('annotation sampling progress', () => {
  it('finds the first missing planned sample and counts manual frames separately', () => {
    const samplingPlan = plan();
    const draft = createAnnotationDraft('pilot', 'a');
    setAnnotationSamplingPlan(draft, samplingPlan);
    addAnnotationFrame(draft, {
      mediaTimeMs: samplingPlan.plannedMediaTimesMs[0] ?? 0,
      width: 640,
      height: 360,
      selection: plannedSelectionForIndex(samplingPlan, 0),
    });
    addAnnotationFrame(draft, {
      mediaTimeMs: 12_345,
      width: 640,
      height: 360,
      selection: { source: 'manual' },
    });

    expect(getAnnotationSamplingProgress(draft)).toEqual({
      plannedCount: 3,
      capturedPlannedCount: 1,
      manualCount: 1,
      nextPlanIndex: 1,
      completedPlanIndices: [0],
    });
  });

  it('reports no next plan index after every planned sample is captured', () => {
    const samplingPlan = plan();
    const draft = createAnnotationDraft('pilot', 'a');
    setAnnotationSamplingPlan(draft, samplingPlan);
    samplingPlan.plannedMediaTimesMs.forEach((time, index) => {
      addAnnotationFrame(draft, {
        mediaTimeMs: time,
        width: 640,
        height: 360,
        selection: plannedSelectionForIndex(samplingPlan, index),
      });
    });
    expect(getAnnotationSamplingProgress(draft).nextPlanIndex).toBeNull();
  });

  it('rejects a planned selection index outside the plan', () => {
    expect(() => plannedSelectionForIndex(plan(), 99)).toThrow('outside');
  });
});
