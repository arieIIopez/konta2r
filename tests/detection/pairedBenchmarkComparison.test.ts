import { describe, expect, it } from 'vitest';
import type { DetectorBenchmarkReport } from '../../src/detection/benchmarkReport';
import { comparePairedDetectorBenchmarkReports } from '../../src/detection/pairedBenchmarkComparison';

function report(
  modelId: string,
  options: {
    macroF1?: number;
    classF1?: number;
    inferenceP95?: number;
    backend?: 'wasm' | 'webgpu';
    annotationSha256?: string;
    deviceLabel?: string;
  } = {},
): DetectorBenchmarkReport {
  const macroF1 = options.macroF1 ?? 0.6;
  const classF1 = options.classF1 ?? macroF1;
  return {
    schemaVersion: '1', runId: `run-${modelId}`, createdAtIso: '2026-08-31T18:50:00.000Z',
    corpus: {
      datasetId: 'pilot', sequenceIds: ['seq-a'], frameCount: 1,
      annotationSha256: options.annotationSha256 ?? 'a'.repeat(64),
      mediaSha256: 'b'.repeat(64),
      manifest: { corpusId: 'frozen-pilot', sha256: 'c'.repeat(64), split: 'validation' },
    },
    device: { label: options.deviceLabel ?? 'legacy-phone', hardwareConcurrency: 4, webgpuAvailable: true },
    benchmark: {
      schemaVersion: '1',
      detector: {
        model: {
          adapterId: 'test', modelId, modelVersion: '1', modelSha256: modelId.padEnd(64, '0').slice(0, 64),
          weightsRedistributionVerified: false, inputWidth: 416, inputHeight: 416, classNames: ['person'],
        },
        runtime: {
          runtime: 'onnxruntime-web', runtimeVersion: '1.29.0', backend: options.backend ?? 'wasm',
          executionProviders: [options.backend ?? 'wasm'],
        },
      },
      frameCount: 1, evaluatedGroundTruthCount: 1, ignoredGroundTruthCount: 0, ignoredDetectionCount: 0,
      matchedIoUMean: 0.75,
      matching: {
        iouThreshold: 0.5,
        imageScaleThresholds: { tinyMaxHeightRatio: 0.04, smallMaxHeightRatio: 0.1, mediumMaxHeightRatio: 0.25 },
      },
      recallByImageScale: [], recallByOcclusion: [],
      frames: [{
        frameId: 'f1', timestampMs: 0, detectionCount: 1, matchCount: 1,
        falsePositiveCount: 0, falseNegativeCount: 0, ignoredDetectionCount: 0, matches: [],
      }],
      latency: {
        sampleCount: 1, totalMsMean: 20, totalMsP50: 20, totalMsP95: 20,
        inferenceMsMean: options.inferenceP95 ?? 15, inferenceMsP50: options.inferenceP95 ?? 15,
        inferenceMsP95: options.inferenceP95 ?? 15, effectiveInferenceFps: 50,
        firstHalfMedianMs: 20, secondHalfMedianMs: 20, latencyDriftRatio: 0,
      },
      classMetrics: [{
        className: 'person', truePositive: 1, falsePositive: 0, falseNegative: 0,
        precision: classF1, recall: classF1, f1: classF1,
      }],
      macroF1,
    },
    confidence: {
      operatingConfidenceThreshold: 0.35,
      sweep: {
        schemaVersion: '1', iouThreshold: 0.5, thresholds: [0.05, 0.35, 0.5], points: [],
        bestObservedMacroF1: { threshold: 0.35, macroF1 }, bestObservedByClass: [],
      },
    },
  };
}

describe('paired detector benchmark comparison', () => {
  it('produces directional deltas only when reports are strictly paired', () => {
    const comparison = comparePairedDetectorBenchmarkReports(
      'ssd-vs-nanodet',
      report('ssd', { macroF1: 0.6, classF1: 0.55, inferenceP95: 40 }),
      report('nanodet', { macroF1: 0.7, classF1: 0.72, inferenceP95: 18 }),
    );
    expect(comparison.comparability).toEqual({ status: 'strict', findings: [] });
    expect(comparison.accuracy.macroF1.rightMinusLeft).toBeCloseTo(0.1, 12);
    expect(comparison.performance.inferenceMsP95.rightMinusLeft).toBe(-22);
    expect(comparison.classes[0]).toMatchObject({ className: 'person', f1Delta: expect.closeTo(0.17, 12) });
  });

  it('invalidates a comparison when frozen corpus identity differs', () => {
    const comparison = comparePairedDetectorBenchmarkReports(
      'bad-corpus', report('ssd'), report('nanodet', { annotationSha256: 'd'.repeat(64) }),
    );
    expect(comparison.comparability.status).toBe('invalid');
    expect(comparison.comparability.findings).toContainEqual(expect.objectContaining({
      code: 'corpus_identity_mismatch', severity: 'error',
    }));
  });

  it('marks different execution backends as conditional rather than attributing latency solely to the model', () => {
    const comparison = comparePairedDetectorBenchmarkReports(
      'mixed-backend', report('ssd', { backend: 'wasm' }), report('nanodet', { backend: 'webgpu' }),
    );
    expect(comparison.comparability.status).toBe('conditional');
    expect(comparison.comparability.findings).toContainEqual(expect.objectContaining({
      code: 'runtime_backend_differs', severity: 'warning',
    }));
  });

  it('invalidates different recorded devices', () => {
    const comparison = comparePairedDetectorBenchmarkReports(
      'mixed-device', report('ssd'), report('nanodet', { deviceLabel: 'new-phone' }),
    );
    expect(comparison.comparability.status).toBe('invalid');
    expect(comparison.comparability.findings.some((finding) => finding.code === 'device_identity_mismatch')).toBe(true);
  });
});
