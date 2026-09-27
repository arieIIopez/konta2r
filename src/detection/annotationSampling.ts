import type { AnnotationDraft } from './annotationDraft';
import type { BenchmarkFrameSelection } from './benchmarkDataset';
import type { TemporalSamplingPlan } from './temporalSampling';

export interface AnnotationSamplingProgress {
  plannedCount: number;
  capturedPlannedCount: number;
  manualCount: number;
  nextPlanIndex: number | null;
  completedPlanIndices: number[];
}

export function plannedSelectionForIndex(
  plan: TemporalSamplingPlan,
  planIndex: number,
): BenchmarkFrameSelection {
  if (!Number.isInteger(planIndex) || planIndex < 0) throw new Error('planIndex must be a non-negative integer');
  const requestedMediaTimeMs = plan.plannedMediaTimesMs[planIndex];
  if (requestedMediaTimeMs === undefined) throw new Error('planIndex is outside the sampling plan');
  return {
    source: 'planned',
    planIndex,
    requestedMediaTimeMs,
  };
}

export function getAnnotationSamplingProgress(draft: AnnotationDraft): AnnotationSamplingProgress {
  const plan = draft.samplingPlan;
  const completedPlanIndices = [...new Set(
    draft.frames
      .filter((frame) => frame.selection?.source === 'planned')
      .map((frame) => frame.selection?.planIndex)
      .filter((value): value is number => value !== undefined),
  )].sort((a, b) => a - b);
  const completed = new Set(completedPlanIndices);
  const plannedCount = plan?.sampleCount ?? 0;
  let nextPlanIndex: number | null = null;
  if (plan) {
    for (let index = 0; index < plan.plannedMediaTimesMs.length; index += 1) {
      if (!completed.has(index)) {
        nextPlanIndex = index;
        break;
      }
    }
  }
  return {
    plannedCount,
    capturedPlannedCount: completedPlanIndices.length,
    manualCount: draft.frames.filter((frame) => frame.selection?.source === 'manual').length,
    nextPlanIndex,
    completedPlanIndices,
  };
}
