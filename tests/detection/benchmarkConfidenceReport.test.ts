import { describe, expect, it } from 'vitest';
import type { AnnotatedDetectorBenchmarkResult } from '../../src/detection/annotatedBenchmark';
import {
  createDetectorBenchmarkReport,
  detectorBenchmarkConfidenceSweepCsv,
  detectorBenchmarkSummaryCsv,
} from '../../src/detection/benchmarkReport';
import type { ConfidenceSweepResult } from '../../src/detection/confidenceSweep';

const benchmark: AnnotatedDetectorBenchmarkResult = {
  schemaVersion: '1',
  detector: {
    model: {
      adapterId: 'test',
      modelId: 'model-a',
      modelVersion: '1',
      modelSha256: 'a'.repeat(64),
      weightsRedistributionVerified: false,
      inputWidth: 300,
      inputHeight: 300,
      classNames: ['person'],
    },
    runtime: { runtime: 'other', backend: 'wasm', executionProviders: ['wasm'] },
  },
  frameCount: 1,
  evaluatedGroundTruthCount: 1,
  ignoredGroundTruthCount: 0,
  ignoredDetectionCount: 0,
  matchedIoUMean: 0.8,
  matching: {
    iouThreshold: 0.5,
    imageScaleThresholds: { tinyMaxHeightRatio: 0.04, smallMaxHeightRatio: 0.1, mediumMaxHeightRatio: 0.25 },
  },
  recallByImageScale: [],
  recallByOcclusion: [],
  frames: [],
  latency: {
    sampleCount: 1,
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
  classMetrics: [{
    className: 'person', truePositive: 1, falsePositive: 0, falseNegative: 0,
    precision: 1, recall: 1, f1: 1,
  }],
  macroF1: 1,
};

const sweep: ConfidenceSweepResult = {
  schemaVersion: '1',
  iouThreshold: 0.5,
  thresholds: [0.2, 0.5],
  points: [
    {
      threshold: 0.2,
      macroF1: 2 / 3,
      classMetrics: [{
        className: 'person', truePositive: 1, falsePositive: 1, falseNegative: 0,
        precision: 0.5, recall: 1, f1: 2 / 3,
      }],
    },
    {
      threshold: 0.5,
      macroF1: 1,
      classMetrics: [{
        className: 'person', truePositive: 1, falsePositive: 0, falseNegative: 0,
        precision: 1, recall: 1, f1: 1,
      }],
    },
  ],
  bestObservedMacroF1: { threshold: 0.5, macroF1: 1 },
  bestObservedByClass: [{
    className: 'person', threshold: 0.5, truePositive: 1, falsePositive: 0, falseNegative: 0,
    precision: 1, recall: 1, f1: 1,
  }],
};

describe('confidence-aware benchmark report', () => {
  it('preserves the operating point separately from observed sweep maxima', () => {
    const report = createDetectorBenchmarkReport({
      runId: 'confidence-run',
      corpus: { datasetId: 'dataset', sequenceIds: ['s1'], frameCount: 1 },
      device: { label: 'phone' },
      benchmark,
      confidence: { operatingConfidenceThreshold: 0.5, sweep },
    });

    expect(report.confidence?.operatingConfidenceThreshold).toBe(0.5);
    expect(report.confidence?.sweep.bestObservedMacroF1).toEqual({ threshold: 0.5, macroF1: 1 });
    const summary = detectorBenchmarkSummaryCsv(report);
    expect(summary).toContain('operatingConfidenceThreshold,bestObservedMacroF1Threshold,bestObservedMacroF1');
    const curve = detectorBenchmarkConfidenceSweepCsv(report);
    expect(curve).toContain('0.2,person,1,1,0,0.5,1');
    expect(curve).toContain('0.5,person,1,0,0,1,1,1,1,true');
  });

  it('rejects confidence analysis evaluated at a different IoU than the primary benchmark', () => {
    expect(() => createDetectorBenchmarkReport({
      runId: 'bad-iou',
      corpus: { datasetId: 'dataset', sequenceIds: ['s1'], frameCount: 1 },
      device: { label: 'phone' },
      benchmark,
      confidence: {
        operatingConfidenceThreshold: 0.5,
        sweep: { ...sweep, iouThreshold: 0.75 },
      },
    })).toThrow('confidence sweep IoU must match');
  });

  it('emits only a header when an old report has no confidence analysis', () => {
    const report = createDetectorBenchmarkReport({
      runId: 'legacy',
      corpus: { datasetId: 'dataset', sequenceIds: ['s1'], frameCount: 1 },
      device: { label: 'phone' },
      benchmark,
    });
    expect(detectorBenchmarkConfidenceSweepCsv(report).trim().split('\n')).toHaveLength(1);
  });
});
