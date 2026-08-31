import { describe, expect, it } from 'vitest';
import type { AnnotatedDetectorBenchmarkResult } from '../../src/detection/annotatedBenchmark';
import {
  createDetectorBenchmarkReport,
  detectorBenchmarkStrataCsv,
  detectorBenchmarkSummaryCsv,
  serializeDetectorBenchmarkReport,
} from '../../src/detection/benchmarkReport';

const benchmark: AnnotatedDetectorBenchmarkResult = {
  schemaVersion: '1',
  detector: {
    model: {
      adapterId: 'mock',
      modelId: 'model-a',
      modelVersion: '1.0',
      modelSha256: 'a'.repeat(64),
      weightsRedistributionVerified: false,
      inputWidth: 300,
      inputHeight: 300,
      classNames: ['person'],
    },
    runtime: {
      runtime: 'onnxruntime-web',
      runtimeVersion: '1.29.0',
      backend: 'wasm',
      executionProviders: ['wasm'],
    },
  },
  frameCount: 2,
  evaluatedGroundTruthCount: 2,
  ignoredGroundTruthCount: 0,
  ignoredDetectionCount: 0,
  matchedIoUMean: 0.8,
  matching: {
    iouThreshold: 0.5,
    imageScaleThresholds: {
      tinyMaxHeightRatio: 0.04,
      smallMaxHeightRatio: 0.1,
      mediumMaxHeightRatio: 0.25,
    },
  },
  recallByImageScale: [
    { className: 'person', value: 'small', groundTruthCount: 2, truePositive: 1, falseNegative: 1, recall: 0.5 },
  ],
  recallByOcclusion: [
    { className: 'person', value: 'partial', groundTruthCount: 1, truePositive: 0, falseNegative: 1, recall: 0 },
  ],
  frames: [
    {
      frameId: 'f1',
      timestampMs: 1000,
      detectionCount: 1,
      matchCount: 1,
      falsePositiveCount: 0,
      falseNegativeCount: 0,
      ignoredDetectionCount: 0,
      matches: [
        {
          annotationId: 'p1',
          detectionIndex: 0,
          className: 'person',
          iou: 0.8,
          confidence: 0.9,
          scaleBin: 'small',
          occlusion: 'none',
        },
      ],
    },
    {
      frameId: 'f2',
      timestampMs: 1200,
      detectionCount: 0,
      matchCount: 0,
      falsePositiveCount: 0,
      falseNegativeCount: 1,
      ignoredDetectionCount: 0,
      matches: [],
    },
  ],
  latency: {
    sampleCount: 2,
    totalMsMean: 15,
    totalMsP50: 10,
    totalMsP95: 20,
    inferenceMsMean: 12,
    inferenceMsP50: 8,
    inferenceMsP95: 16,
    effectiveInferenceFps: 66.6666666667,
    firstHalfMedianMs: 10,
    secondHalfMedianMs: 20,
    latencyDriftRatio: 1,
  },
  classMetrics: [
    {
      className: 'person',
      truePositive: 1,
      falsePositive: 0,
      falseNegative: 1,
      precision: 1,
      recall: 0.5,
      f1: 2 / 3,
    },
  ],
  macroF1: 2 / 3,
};

describe('detector benchmark report', () => {
  it('binds one mathematical result to corpus and device identity', () => {
    const report = createDetectorBenchmarkReport({
      runId: 'run-001',
      createdAtIso: '2026-08-31T03:00:00.000Z',
      corpus: {
        datasetId: 'konta2r-pilot',
        sequenceIds: ['seq-a'],
        frameCount: 2,
        annotationSha256: 'b'.repeat(64),
      },
      device: {
        label: 'Moto G, legacy',
        hardwareConcurrency: 4,
        webgpuAvailable: false,
      },
      benchmark,
      notes: ['warmup excluded'],
    });

    expect(report.schemaVersion).toBe('1');
    expect(report.corpus.annotationSha256).toBe('b'.repeat(64));
    expect(report.benchmark.detector.model.modelId).toBe('model-a');
    expect(report.notes).toEqual(['warmup excluded']);
  });

  it('rejects a corpus identity whose frame count disagrees with the benchmark', () => {
    expect(() => createDetectorBenchmarkReport({
      runId: 'bad',
      corpus: { datasetId: 'd', sequenceIds: ['s'], frameCount: 3 },
      device: { label: 'device' },
      benchmark,
    })).toThrow('frameCount must match');
  });

  it('serializes JSON and class-summary CSV with reproducibility metadata', () => {
    const report = createDetectorBenchmarkReport({
      runId: 'run-001',
      createdAtIso: '2026-08-31T03:00:00.000Z',
      corpus: { datasetId: 'dataset', sequenceIds: ['sequence'], frameCount: 2 },
      device: { label: 'Phone, old' },
      benchmark,
    });

    const json = serializeDetectorBenchmarkReport(report);
    const csv = detectorBenchmarkSummaryCsv(report);

    expect(json.endsWith('\n')).toBe(true);
    expect(JSON.parse(json).benchmark.classMetrics[0].recall).toBe(0.5);
    expect(csv).toContain('runId,createdAtIso,datasetId');
    expect(csv).toContain('"Phone, old"');
    expect(csv).toContain('person,1,0,1,1,0.5');
  });

  it('exports scale and occlusion recall as separate strata rows', () => {
    const report = createDetectorBenchmarkReport({
      runId: 'run-001',
      createdAtIso: '2026-08-31T03:00:00.000Z',
      corpus: { datasetId: 'dataset', sequenceIds: ['sequence'], frameCount: 2 },
      device: { label: 'device' },
      benchmark,
    });

    const csv = detectorBenchmarkStrataCsv(report);
    expect(csv).toContain('image_scale,person,small,2,1,1,0.5');
    expect(csv).toContain('occlusion,person,partial,1,0,1,0');
  });
});
