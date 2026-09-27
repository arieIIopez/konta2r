import { describe, expect, it } from 'vitest';
import {
  addAnnotationFrame,
  createAnnotationDraft,
  restoreAnnotationDraft,
  serializeAnnotationDraft,
  setAnnotationSamplingPlan,
  toAnnotatedBenchmarkSequence,
} from '../../src/detection/annotationDraft';
import { parseAnnotatedBenchmarkSequenceJson } from '../../src/detection/benchmarkDatasetParser';
import { validateAnnotatedBenchmarkSequence } from '../../src/detection/benchmarkDataset';
import { createTemporalSamplingPlan } from '../../src/detection/temporalSampling';

function plan() {
  return createTemporalSamplingPlan({
    durationMs: 60_000,
    sampleCount: 6,
    seed: 'pilot-001',
    startMarginMs: 2_000,
    endMarginMs: 2_000,
    jitterFraction: 0.5,
  });
}

describe('annotation sampling provenance', () => {
  it('round-trips a reproducible sampling plan and planned frame selection', () => {
    const samplingPlan = plan();
    const draft = createAnnotationDraft('pilot', 'street-a');
    setAnnotationSamplingPlan(draft, samplingPlan);
    const requested = samplingPlan.plannedMediaTimesMs[2];
    expect(requested).toBeDefined();
    addAnnotationFrame(draft, {
      mediaTimeMs: (requested ?? 0) + 12,
      width: 1280,
      height: 720,
      selection: {
        source: 'planned',
        planIndex: 2,
        requestedMediaTimeMs: requested ?? 0,
      },
    });

    const parsed = parseAnnotatedBenchmarkSequenceJson(serializeAnnotationDraft(draft));
    expect(parsed.samplingPlan).toEqual(samplingPlan);
    expect(parsed.frames[0]?.selection).toEqual({
      source: 'planned',
      planIndex: 2,
      requestedMediaTimeMs: requested,
    });
    expect(parsed.frames[0]?.mediaTimeMs).toBe((requested ?? 0) + 12);
    expect(() => validateAnnotatedBenchmarkSequence(parsed)).not.toThrow();
  });

  it('labels convenience frames as manual without pretending they came from the plan', () => {
    const draft = createAnnotationDraft('pilot', 'street-a');
    setAnnotationSamplingPlan(draft, plan());
    addAnnotationFrame(draft, {
      mediaTimeMs: 7_500,
      width: 640,
      height: 360,
      selection: { source: 'manual' },
    });
    expect(toAnnotatedBenchmarkSequence(draft).frames[0]?.selection).toEqual({ source: 'manual' });
  });

  it('rejects two frames claiming the same planned sample index', () => {
    const samplingPlan = plan();
    const requested = samplingPlan.plannedMediaTimesMs[1] ?? 0;
    const sequence = {
      schemaVersion: '1' as const,
      datasetId: 'pilot',
      sequenceId: 'street-a',
      samplingPlan,
      frames: [
        {
          frameId: 'frame-a', timestampMs: requested, mediaTimeMs: requested,
          width: 640, height: 360, objects: [],
          selection: { source: 'planned' as const, planIndex: 1, requestedMediaTimeMs: requested },
        },
        {
          frameId: 'frame-b', timestampMs: requested + 1, mediaTimeMs: requested + 1,
          width: 640, height: 360, objects: [],
          selection: { source: 'planned' as const, planIndex: 1, requestedMediaTimeMs: requested },
        },
      ],
    };
    expect(() => validateAnnotatedBenchmarkSequence(sequence)).toThrow('assigned to more than one frame');
  });

  it('refuses to silently replace a sampling plan that would invalidate existing planned frames', () => {
    const firstPlan = plan();
    const draft = createAnnotationDraft('pilot', 'street-a');
    setAnnotationSamplingPlan(draft, firstPlan);
    const requested = firstPlan.plannedMediaTimesMs[0] ?? 0;
    addAnnotationFrame(draft, {
      mediaTimeMs: requested,
      width: 640,
      height: 360,
      selection: { source: 'planned', planIndex: 0, requestedMediaTimeMs: requested },
    });

    const incompatible = createTemporalSamplingPlan({
      durationMs: 60_000,
      sampleCount: 6,
      seed: 'different-seed',
      startMarginMs: 2_000,
      endMarginMs: 2_000,
      jitterFraction: 0.5,
    });
    expect(() => setAnnotationSamplingPlan(draft, incompatible)).toThrow('incompatible');
  });

  it('restores sampling metadata from a parsed sequence', () => {
    const samplingPlan = plan();
    const draft = createAnnotationDraft('pilot', 'street-a');
    setAnnotationSamplingPlan(draft, samplingPlan);
    const restored = restoreAnnotationDraft(parseAnnotatedBenchmarkSequenceJson(serializeAnnotationDraft(draft)));
    expect(restored.samplingPlan).toEqual(samplingPlan);
  });
});
