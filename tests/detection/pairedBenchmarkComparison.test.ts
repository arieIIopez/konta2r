import { describe, expect, it } from 'vitest';
import type { AnnotatedDetectorBenchmarkResult } from '../../src/detection/annotatedBenchmark';
import { createDetectorBenchmarkReport, type DetectorBenchmarkReport } from '../../src/detection/benchmarkReport';
import type { ConfidenceSweepResult } from '../../src/detection/confidenceSweep';
import { compareDetectorBenchmarkReports } from '../../src/detection/pairedBenchmarkComparison';

const ANNOTATION_SHA = 'a'.repeat(64);
const MEDIA_SHA = 'b'.repeat(64);
const MANIFEST_SHA = 'c'.repeat(64);

interface ReportOptions {
  modelId?: string;
  modelSha?: string;
  macroF1?: number;
  matchedIoU?: number;
  totalMsP50?: number;
  backend?: 'wasm' | 'webgpu';
  executionProviders?: ('wasm' | 'webgpu')[];
  includeManifest?: boolean;
  includeHashes?: boolean;
  operatingThreshold?: number;
  tinyMaxHeightRatio?: number;
  includeMediaTime?: boolean;
  classNames?: string[];
  deviceLabel?: string;
  userAgent?: string;
  hardwareConcurrency?: number;
}

function classMetric(className: string, f1: number) {
  return {
    className,
    truePositive: 8,
    falsePositive: 1,
    falseNegative: 1,
    precision: f1,
    recall: f1,
    f1,
  };
}

function confidenceSweep(classNames: string[], macroF1: number): ConfidenceSweepResult {
  const low = Math.max(0, macroF1 - 0.1);
  return {
    schemaVersion: '1',
    iouThreshold: 0.5,
    thresholds: [0.1, 0.5],
    points: [
      {
        threshold: 0.1,
        macroF1: low,
        classMetrics: classNames.map((name) => classMetric(name, low)),
      },
      {
        threshold: 0.5,
        macroF1,
        classMetrics: classNames.map((name) => classMetric(name, macroF1)),
      },
    ],
    bestObservedMacroF1: { threshold: 0.5, macroF1 },
    bestObservedByClass: classNames.map((name) => ({
      ...classMetric(name, macroF1),
      threshold: 0.5,
    })),
  };
}

function makeReport(options: ReportOptions = {}): DetectorBenchmarkReport {
  const modelId = options.modelId ?? 'model-left';
  const modelSha = options.modelSha ?? 'd'.repeat(64);
  const macroF1 = options.macroF1 ?? 0.8;
  const matchedIoU = options.matchedIoU ?? 0.75;
  const totalMsP50 = options.totalMsP50 ?? 20;
  const backend = options.backend ?? 'wasm';
  const executionProviders = options.executionProviders ?? [backend];
  const classNames = options.classNames ?? ['person'];
  const includeManifest = options.includeManifest ?? true;
  const includeHashes = options.includeHashes ?? true;
  const includeMediaTime = options.includeMediaTime ?? true;

  const benchmark: AnnotatedDetectorBenchmarkResult = {
    schemaVersion: '1',
    detector: {
      model: {
        adapterId: 'test',
        modelId,
        modelVersion: '1',
        modelSha256: modelSha,
        weightsRedistributionVerified: false,
        inputWidth: 416,
        inputHeight: 416,
        classNames: [...classNames],
      },
      runtime: {
        runtime: 'onnxruntime-web',
        runtimeVersion: '1.29.0',
        backend,
        executionProviders,
      },
    },
    frameCount: 1,
    evaluatedGroundTruthCount: 1,
    ignoredGroundTruthCount: 0,
    ignoredDetectionCount: 0,
    matchedIoUMean: matchedIoU,
    matching: {
      iouThreshold: 0.5,
      imageScaleThresholds: {
        tinyMaxHeightRatio: options.tinyMaxHeightRatio ?? 0.04,
        smallMaxHeightRatio: 0.1,
        mediumMaxHeightRatio: 0.25,
      },
    },
    recallByImageScale: [],
    recallByOcclusion: [],
    frames: [{
      frameId: 'frame-001',
      timestampMs: 1_000,
      ...(includeMediaTime ? { mediaTimeMs: 500 } : {}),
      detectionCount: 1,
      matchCount: 1,
      falsePositiveCount: 0,
      falseNegativeCount: 0,
      ignoredDetectionCount: 0,
      matches: [],
    }],
    latency: {
      sampleCount: 1,
      totalMsMean: totalMsP50,
      totalMsP50,
      totalMsP95: totalMsP50 * 2,
      inferenceMsMean: totalMsP50 * 0.8,
      inferenceMsP50: totalMsP50 * 0.8,
      inferenceMsP95: totalMsP50 * 1.6,
      effectiveInferenceFps: 1_000 / totalMsP50,
      firstHalfMedianMs: totalMsP50,
      secondHalfMedianMs: totalMsP50,
      latencyDriftRatio: 0,
    },
    classMetrics: classNames.map((name) => classMetric(name, macroF1)),
    macroF1,
  };

  return createDetectorBenchmarkReport({
    runId: `run-${modelId}`,
    createdAtIso: '2026-08-31T20:00:00.000Z',
    corpus: {
      datasetId: 'konta2r-pilot',
      sequenceIds: ['seq-001'],
      frameCount: 1,
      ...(includeHashes ? { annotationSha256: ANNOTATION_SHA, mediaSha256: MEDIA_SHA } : {}),
      ...(includeManifest
        ? { manifest: { corpusId: 'pilot-v1', sha256: MANIFEST_SHA, split: 'validation' as const } }
        : {}),
    },
    device: {
      label: options.deviceLabel ?? 'old-phone-a',
      userAgent: options.userAgent ?? 'Konta2rTest/1',
      hardwareConcurrency: options.hardwareConcurrency ?? 4,
      webgpuAvailable: false,
    },
    benchmark,
    confidence: {
      operatingConfidenceThreshold: options.operatingThreshold ?? 0.5,
      sweep: confidenceSweep(classNames, macroF1),
    },
  });
}

function findingCodes(report: { findings: Array<{ code: string }> }): string[] {
  return report.findings.map((finding) => finding.code);
}

describe('paired detector benchmark comparison', () => {
  it('compares two models only on the same frozen evidence and reports deltas without declaring a winner', () => {
    const left = makeReport({ modelId: 'ssd', modelSha: '1'.repeat(64), macroF1: 0.8, totalMsP50: 20 });
    const right = makeReport({ modelId: 'nanodet', modelSha: '2'.repeat(64), macroF1: 0.9, matchedIoU: 0.8, totalMsP50: 10 });

    const comparison = compareDetectorBenchmarkReports(left, right);

    expect(comparison.corpusGate.status).toBe('comparable');
    expect(comparison.operatingPoint.gate.status).toBe('comparable');
    expect(comparison.operatingPoint.macroF1Delta).toBeCloseTo(0.1, 12);
    expect(comparison.operatingPoint.matchedIoUMeanDelta).toBeCloseTo(0.05, 12);
    expect(comparison.operatingPoint.byClass[0]?.f1Delta).toBeCloseTo(0.1, 12);
    expect(comparison.confidenceSweep.gate.status).toBe('comparable');
    expect(comparison.confidenceSweep.points).toHaveLength(2);
    expect(comparison.performance.gate.status).toBe('comparable');
    expect(comparison.performance.totalMsP50RatioRightToLeft).toBe(0.5);
    expect(comparison.performance.effectiveInferenceFpsRatioRightToLeft).toBe(2);
    expect('winner' in comparison).toBe(false);
  });

  it('marks comparison provisional when both reports lack frozen manifest and file hashes', () => {
    const left = makeReport({ includeManifest: false, includeHashes: false });
    const right = makeReport({ modelId: 'right', modelSha: 'e'.repeat(64), includeManifest: false, includeHashes: false });

    const comparison = compareDetectorBenchmarkReports(left, right);

    expect(comparison.corpusGate.status).toBe('provisional');
    expect(findingCodes(comparison.corpusGate)).toEqual(expect.arrayContaining([
      'manifest_identity_unproven',
      'annotation_hash_unproven',
      'media_hash_unproven',
    ]));
    expect(comparison.operatingPoint.gate.status).toBe('provisional');
  });

  it('fails closed when corpus identities differ and suppresses comparative deltas', () => {
    const left = makeReport();
    const right = makeReport({ modelId: 'right', modelSha: 'e'.repeat(64) });
    if (!right.corpus.manifest) throw new Error('fixture manifest missing');
    right.corpus.manifest.sha256 = 'f'.repeat(64);
    right.corpus.annotationSha256 = '0'.repeat(64);

    const comparison = compareDetectorBenchmarkReports(left, right);

    expect(comparison.corpusGate.status).toBe('incompatible');
    expect(findingCodes(comparison.corpusGate)).toEqual(expect.arrayContaining([
      'manifest_identity_mismatch',
      'annotation_hash_mismatch',
    ]));
    expect(comparison.operatingPoint.macroF1Delta).toBeUndefined();
    expect(comparison.operatingPoint.byClass[0]?.f1Delta).toBeUndefined();
    expect(comparison.confidenceSweep.points).toEqual([]);
    expect(comparison.performance.totalMsP50RatioRightToLeft).toBeUndefined();
  });

  it('detects tiny-scale threshold changes and one-sided media time as corpus incompatibilities', () => {
    const left = makeReport();
    const right = makeReport({ modelId: 'right', modelSha: 'e'.repeat(64), tinyMaxHeightRatio: 0.05, includeMediaTime: false });

    const comparison = compareDetectorBenchmarkReports(left, right);

    expect(comparison.corpusGate.status).toBe('incompatible');
    expect(findingCodes(comparison.corpusGate)).toEqual(expect.arrayContaining([
      'image_scale_threshold_mismatch',
      'media_time_mismatch',
    ]));
  });

  it('keeps accuracy comparable but blocks performance ratios when runtime backend differs', () => {
    const left = makeReport();
    const right = makeReport({
      modelId: 'right', modelSha: 'e'.repeat(64), backend: 'webgpu', executionProviders: ['webgpu', 'wasm'],
    });

    const comparison = compareDetectorBenchmarkReports(left, right);

    expect(comparison.corpusGate.status).toBe('comparable');
    expect(comparison.operatingPoint.gate.status).toBe('comparable');
    expect(comparison.performance.gate.status).toBe('incompatible');
    expect(findingCodes(comparison.performance.gate)).toEqual(expect.arrayContaining([
      'backend_mismatch',
      'execution_providers_mismatch',
    ]));
    expect(comparison.performance.inferenceMsP50RatioRightToLeft).toBeUndefined();
  });

  it('blocks point-operating and performance comparisons at different confidence thresholds while preserving the neutral sweep', () => {
    const left = makeReport({ operatingThreshold: 0.5 });
    const right = makeReport({ modelId: 'right', modelSha: 'e'.repeat(64), operatingThreshold: 0.6 });

    const comparison = compareDetectorBenchmarkReports(left, right);

    expect(comparison.operatingPoint.gate.status).toBe('incompatible');
    expect(findingCodes(comparison.operatingPoint.gate)).toContain('operating_threshold_mismatch');
    expect(comparison.operatingPoint.macroF1Delta).toBeUndefined();
    expect(comparison.confidenceSweep.gate.status).toBe('comparable');
    expect(comparison.confidenceSweep.points).toHaveLength(2);
    expect(comparison.performance.gate.status).toBe('incompatible');
  });

  it('rejects macro-F1 and sweep deltas when class sets differ', () => {
    const left = makeReport({ classNames: ['person'] });
    const right = makeReport({ modelId: 'right', modelSha: 'e'.repeat(64), classNames: ['person', 'bicycle'] });

    const comparison = compareDetectorBenchmarkReports(left, right);

    expect(comparison.operatingPoint.gate.status).toBe('incompatible');
    expect(findingCodes(comparison.operatingPoint.gate)).toContain('operating_class_set_mismatch');
    expect(comparison.operatingPoint.macroF1Delta).toBeUndefined();
    expect(comparison.confidenceSweep.gate.status).toBe('incompatible');
    expect(findingCodes(comparison.confidenceSweep.gate)).toContain('sweep_class_set_mismatch');
    expect(comparison.confidenceSweep.points).toEqual([]);
  });
});
