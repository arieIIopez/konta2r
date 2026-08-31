import { describe, expect, it } from 'vitest';
import { summarizeCorpusComposition } from '../../src/detection/corpusComposition';
import type { AnnotatedBenchmarkSequence } from '../../src/detection/benchmarkDataset';
import { createTemporalSamplingPlan } from '../../src/detection/temporalSampling';

function sequence(): AnnotatedBenchmarkSequence {
  const plan = createTemporalSamplingPlan({ durationMs: 30_000, sampleCount: 3, seed: 'composition', jitterFraction: 0 });
  return {
    schemaVersion: '1',
    datasetId: 'pilot',
    sequenceId: 'street-a',
    samplingPlan: plan,
    frames: [
      {
        frameId: 'f1', timestampMs: 5_000, mediaTimeMs: 5_010,
        width: 1000, height: 1000,
        selection: { source: 'planned', planIndex: 0, requestedMediaTimeMs: plan.plannedMediaTimesMs[0] ?? 5_000 },
        objects: [
          { annotationId: 'a1', className: 'person', bbox: { x: 10, y: 10, width: 20, height: 30 }, occlusion: 'partial' },
          { annotationId: 'a2', className: 'car', bbox: { x: 100, y: 100, width: 220, height: 300 } },
          { annotationId: 'a3', className: 'truck', bbox: { x: 400, y: 100, width: 200, height: 200 }, ignore: true },
        ],
      },
      {
        frameId: 'f2', timestampMs: 12_000, mediaTimeMs: 12_000,
        width: 1000, height: 1000,
        selection: { source: 'manual' },
        objects: [],
      },
    ],
  };
}

describe('corpus composition report', () => {
  it('summarizes evaluable, ignored, negative, scale and occlusion composition', () => {
    const report = summarizeCorpusComposition(sequence());
    expect(report.frameCount).toBe(2);
    expect(report.objectCount).toBe(3);
    expect(report.evaluableObjectCount).toBe(2);
    expect(report.ignoredObjectCount).toBe(1);
    expect(report.negativeFrameCount).toBe(1);
    expect(report.classCounts.person).toBe(1);
    expect(report.classCounts.car).toBe(1);
    expect(report.classCounts.truck).toBe(1);
    expect(report.occlusionCounts.partial).toBe(1);
    expect(report.occlusionCounts.none).toBe(1);
    expect(report.imageScaleCounts.tiny).toBe(1);
    expect(report.imageScaleCounts.large).toBe(1);
  });

  it('keeps sampling coverage and manual frames separate', () => {
    const report = summarizeCorpusComposition(sequence());
    expect(report.selectionCounts).toEqual({ planned: 1, manual: 1, unclassified: 0 });
    expect(report.samplingCoverage).toEqual({ plannedCount: 3, capturedPlannedCount: 1, ratio: 1 / 3 });
    expect(report.findings.some((finding) => finding.code === 'sampling_plan_incomplete' && finding.severity === 'warning')).toBe(true);
    expect(report.findings.some((finding) => finding.code === 'manual_frames_present' && finding.severity === 'info')).toBe(true);
  });

  it('reports absent classes descriptively rather than failing the corpus', () => {
    const report = summarizeCorpusComposition(sequence());
    const absent = report.findings.filter((finding) => finding.code === 'class_absent').map((finding) => finding.className);
    expect(absent).toContain('bicycle');
    expect(absent).toContain('bus');
    expect(report.schemaVersion).toBe('1');
  });

  it('identifies sequences without background-only, occluded or small-object exposure', () => {
    const clean: AnnotatedBenchmarkSequence = {
      schemaVersion: '1', datasetId: 'p', sequenceId: 'clean',
      frames: [
        { frameId: 'a', timestampMs: 0, width: 640, height: 360, objects: [
          { annotationId: 'x', className: 'car', bbox: { x: 100, y: 100, width: 200, height: 180 } },
        ] },
        { frameId: 'b', timestampMs: 1, width: 640, height: 360, objects: [
          { annotationId: 'y', className: 'car', bbox: { x: 110, y: 100, width: 200, height: 180 } },
        ] },
      ],
    };
    const codes = summarizeCorpusComposition(clean).findings.map((finding) => finding.code);
    expect(codes).toContain('no_negative_frames');
    expect(codes).toContain('no_occluded_objects');
    expect(codes).toContain('no_tiny_or_small_objects');
  });

  it('does not issue a pass/fail quality verdict', () => {
    const report = summarizeCorpusComposition(sequence()) as unknown as Record<string, unknown>;
    expect(report.valid).toBeUndefined();
    expect(report.status).toBeUndefined();
    expect(report.score).toBeUndefined();
  });
});
