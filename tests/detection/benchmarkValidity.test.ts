import { describe, expect, it } from 'vitest';
import type { DetectorBenchmarkReport } from '../../src/detection/benchmarkReport';
import { assessDetectorBenchmarkValidity } from '../../src/detection/benchmarkValidity';

function report(overrides: {
  modelHash?: string;
  annotationHash?: string;
  mediaHash?: string;
  timed?: boolean;
  actualTimes?: readonly (number | undefined)[];
  frameCount?: number;
} = {}): DetectorBenchmarkReport {
  const frameCount = overrides.frameCount ?? 2;
  const timed = overrides.timed ?? true;
  const actualTimes = overrides.actualTimes ?? [500, 700];
  const frames = Array.from({ length: frameCount }, (_, index) => ({
    frameId: `f${index + 1}`,
    timestampMs: 1000 + index * 200,
    ...(timed ? { mediaTimeMs: 500 + index * 200 } : {}),
    ...(timed && actualTimes[index] !== undefined ? {
      actualMediaTimeMs: actualTimes[index],
      seekErrorMs: (actualTimes[index] ?? 0) - (500 + index * 200),
    } : {}),
    detectionCount: 0,
    matchCount: 0,
    falsePositiveCount: 0,
    falseNegativeCount: 0,
    ignoredDetectionCount: 0,
    matches: [],
  }));

  return {
    schemaVersion: '1',
    runId: 'run',
    createdAtIso: '2026-08-31T03:00:00.000Z',
    corpus: {
      datasetId: 'dataset',
      sequenceIds: ['seq'],
      frameCount,
      ...(overrides.annotationHash === undefined ? {} : { annotationSha256: overrides.annotationHash }),
      ...(overrides.mediaHash === undefined ? {} : { mediaSha256: overrides.mediaHash }),
    },
    device: { label: 'phone' },
    benchmark: {
      schemaVersion: '1',
      detector: {
        model: {
          adapterId: 'mock',
          modelId: 'model',
          modelVersion: '1',
          ...(overrides.modelHash === undefined ? {} : { modelSha256: overrides.modelHash }),
          weightsRedistributionVerified: false,
          inputWidth: 300,
          inputHeight: 300,
          classNames: ['person'],
        },
        runtime: { runtime: 'other', backend: 'unknown', executionProviders: ['unknown'] },
      },
      frameCount,
      evaluatedGroundTruthCount: 0,
      ignoredGroundTruthCount: 0,
      ignoredDetectionCount: 0,
      matchedIoUMean: 0,
      ...(timed && actualTimes.every((value) => value !== undefined) ? {
        mediaSeek: {
          sampleCount: frameCount,
          absoluteErrorMeanMs: 0,
          absoluteErrorMaxMs: 0,
        },
      } : {}),
      matching: {
        iouThreshold: 0.5,
        imageScaleThresholds: {
          tinyMaxHeightRatio: 0.04,
          smallMaxHeightRatio: 0.1,
          mediumMaxHeightRatio: 0.25,
        },
      },
      recallByImageScale: [],
      recallByOcclusion: [],
      frames,
      latency: {
        sampleCount: frameCount,
        totalMsMean: 10,
        totalMsP50: 10,
        totalMsP95: 10,
        inferenceMsMean: 8,
        inferenceMsP50: 8,
        inferenceMsP95: 8,
        effectiveInferenceFps: 100,
        firstHalfMedianMs: 10,
        secondHalfMedianMs: 10,
        latencyDriftRatio: 0,
      },
      classMetrics: [],
      macroF1: 0,
    },
  };
}

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const SHA_C = 'c'.repeat(64);

describe('benchmark validity gate', () => {
  it('accepts a fully identified timed run for selection', () => {
    const assessment = assessDetectorBenchmarkValidity(report({
      modelHash: SHA_A,
      annotationHash: SHA_B,
      mediaHash: SHA_C,
    }));

    expect(assessment.status).toBe('valid');
    expect(assessment.profile).toBe('selection');
    expect(assessment.findings).toEqual([]);
    expect(assessment.presentedFrameCoverage).toBe(1);
  });

  it('marks missing identity/evidence as invalid for model selection', () => {
    const assessment = assessDetectorBenchmarkValidity(report({ actualTimes: [500, undefined] }));

    expect(assessment.status).toBe('invalid');
    expect(assessment.findings.map((item) => item.code)).toEqual(expect.arrayContaining([
      'model_hash_missing',
      'annotation_hash_missing',
      'media_hash_missing',
      'presented_frame_coverage_incomplete',
    ]));
    expect(assessment.presentedFrameCoverage).toBe(0.5);
  });

  it('downgrades the same missing evidence to provisional in development profile', () => {
    const assessment = assessDetectorBenchmarkValidity(
      report({ actualTimes: [500, undefined] }),
      { profile: 'development' },
    );

    expect(assessment.status).toBe('provisional');
    expect(assessment.findings.every((item) => item.severity === 'warning')).toBe(true);
  });

  it('invalidates excessive seek error in every profile', () => {
    const assessment = assessDetectorBenchmarkValidity(
      report({
        modelHash: SHA_A,
        annotationHash: SHA_B,
        mediaHash: SHA_C,
        actualTimes: [500, 780],
      }),
      { profile: 'development', maxSeekErrorMs: 50 },
    );

    expect(assessment.status).toBe('invalid');
    expect(assessment.maxObservedSeekErrorMs).toBe(80);
    expect(assessment.findings).toContainEqual(expect.objectContaining({
      code: 'seek_error_exceeds_limit',
      severity: 'error',
    }));
  });

  it('does not require a media hash or presented timing for image-only corpora', () => {
    const assessment = assessDetectorBenchmarkValidity(report({
      timed: false,
      modelHash: SHA_A,
      annotationHash: SHA_B,
    }));

    expect(assessment.status).toBe('valid');
    expect(assessment.timedFrameCount).toBe(0);
    expect(assessment.presentedFrameCoverage).toBeNull();
  });

  it('always invalidates an empty benchmark', () => {
    const assessment = assessDetectorBenchmarkValidity(report({
      timed: false,
      modelHash: SHA_A,
      annotationHash: SHA_B,
      frameCount: 0,
    }), { profile: 'development' });

    expect(assessment.status).toBe('invalid');
    expect(assessment.findings).toContainEqual(expect.objectContaining({ code: 'empty_benchmark' }));
  });
});
