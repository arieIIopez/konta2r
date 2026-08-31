import type { DetectorClassMetrics } from './types';
import type { DetectorBenchmarkReport } from './benchmarkReport';

export type PairedBenchmarkComparabilityStatus = 'strict' | 'conditional' | 'invalid';
export type PairedBenchmarkFindingSeverity = 'warning' | 'error';

export interface PairedBenchmarkFinding {
  code:
    | 'corpus_identity_mismatch'
    | 'device_identity_mismatch'
    | 'matching_policy_mismatch'
    | 'confidence_policy_mismatch'
    | 'runtime_backend_differs';
  severity: PairedBenchmarkFindingSeverity;
  message: string;
}

export interface PairedMetricDelta {
  left: number;
  right: number;
  rightMinusLeft: number;
}

export interface PairedClassComparison {
  className: string;
  left: DetectorClassMetrics | null;
  right: DetectorClassMetrics | null;
  f1Delta: number | null;
  precisionDelta: number | null;
  recallDelta: number | null;
}

export interface PairedDetectorBenchmarkComparison {
  schemaVersion: '1';
  comparisonId: string;
  left: {
    runId: string;
    modelId: string;
    modelSha256: string;
  };
  right: {
    runId: string;
    modelId: string;
    modelSha256: string;
  };
  comparability: {
    status: PairedBenchmarkComparabilityStatus;
    findings: PairedBenchmarkFinding[];
  };
  accuracy: {
    macroF1: PairedMetricDelta;
    matchedIoUMean: PairedMetricDelta;
    bestObservedMacroF1: PairedMetricDelta | null;
  };
  performance: {
    inferenceMsP50: PairedMetricDelta;
    inferenceMsP95: PairedMetricDelta;
    totalMsP50: PairedMetricDelta;
    totalMsP95: PairedMetricDelta;
    effectiveInferenceFps: PairedMetricDelta;
    latencyDriftRatio: PairedMetricDelta;
  };
  classes: PairedClassComparison[];
}

function delta(left: number, right: number): PairedMetricDelta {
  return { left, right, rightMinusLeft: right - left };
}

function exactArray<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameOptional(left: string | undefined, right: string | undefined): boolean {
  return left === right;
}

function corpusMatches(left: DetectorBenchmarkReport, right: DetectorBenchmarkReport): boolean {
  const a = left.corpus;
  const b = right.corpus;
  return a.datasetId === b.datasetId
    && exactArray(a.sequenceIds, b.sequenceIds)
    && a.frameCount === b.frameCount
    && sameOptional(a.annotationSha256, b.annotationSha256)
    && sameOptional(a.mediaSha256, b.mediaSha256)
    && a.manifest?.corpusId === b.manifest?.corpusId
    && a.manifest?.sha256 === b.manifest?.sha256
    && a.manifest?.split === b.manifest?.split;
}

function deviceMatches(left: DetectorBenchmarkReport, right: DetectorBenchmarkReport): boolean {
  const a = left.device;
  const b = right.device;
  return a.label === b.label
    && a.userAgent === b.userAgent
    && a.hardwareConcurrency === b.hardwareConcurrency
    && a.deviceMemoryGiB === b.deviceMemoryGiB
    && a.webgpuAvailable === b.webgpuAvailable;
}

function matchingPolicyMatches(left: DetectorBenchmarkReport, right: DetectorBenchmarkReport): boolean {
  const a = left.benchmark.matching;
  const b = right.benchmark.matching;
  return Math.abs(a.iouThreshold - b.iouThreshold) <= 1e-12
    && a.imageScaleThresholds.tinyMaxHeightRatio === b.imageScaleThresholds.tinyMaxHeightRatio
    && a.imageScaleThresholds.smallMaxHeightRatio === b.imageScaleThresholds.smallMaxHeightRatio
    && a.imageScaleThresholds.mediumMaxHeightRatio === b.imageScaleThresholds.mediumMaxHeightRatio;
}

function confidencePolicyMatches(left: DetectorBenchmarkReport, right: DetectorBenchmarkReport): boolean {
  const a = left.confidence;
  const b = right.confidence;
  if (!a || !b) return a === b;
  return a.operatingConfidenceThreshold === b.operatingConfidenceThreshold
    && a.sweep.iouThreshold === b.sweep.iouThreshold
    && exactArray(a.sweep.thresholds, b.sweep.thresholds);
}

function classMap(report: DetectorBenchmarkReport): Map<string, DetectorClassMetrics> {
  return new Map(report.benchmark.classMetrics.map((metric) => [metric.className, metric]));
}

function compareClasses(
  left: DetectorBenchmarkReport,
  right: DetectorBenchmarkReport,
): PairedClassComparison[] {
  const leftMap = classMap(left);
  const rightMap = classMap(right);
  const names = [...new Set([...leftMap.keys(), ...rightMap.keys()])].sort();
  return names.map((className) => {
    const a = leftMap.get(className) ?? null;
    const b = rightMap.get(className) ?? null;
    return {
      className,
      left: a ? { ...a } : null,
      right: b ? { ...b } : null,
      f1Delta: a && b ? b.f1 - a.f1 : null,
      precisionDelta: a && b ? b.precision - a.precision : null,
      recallDelta: a && b ? b.recall - a.recall : null,
    };
  });
}

/**
 * Compares two completed reports only after testing whether the experimental
 * conditions are genuinely paired. It reports directional deltas but never
 * declares a winner; selection remains a separate policy/scientific decision.
 */
export function comparePairedDetectorBenchmarkReports(
  comparisonId: string,
  left: DetectorBenchmarkReport,
  right: DetectorBenchmarkReport,
): PairedDetectorBenchmarkComparison {
  if (comparisonId.trim().length === 0) throw new Error('comparisonId is required');
  const findings: PairedBenchmarkFinding[] = [];

  if (!corpusMatches(left, right)) {
    findings.push({
      code: 'corpus_identity_mismatch', severity: 'error',
      message: 'Reports do not reference the same frozen corpus identity and cannot be treated as a paired comparison.',
    });
  }
  if (!deviceMatches(left, right)) {
    findings.push({
      code: 'device_identity_mismatch', severity: 'error',
      message: 'Reports were not produced under the same recorded device identity.',
    });
  }
  if (!matchingPolicyMatches(left, right)) {
    findings.push({
      code: 'matching_policy_mismatch', severity: 'error',
      message: 'IoU or image-scale matching policy differs between reports.',
    });
  }
  if (!confidencePolicyMatches(left, right)) {
    findings.push({
      code: 'confidence_policy_mismatch', severity: 'error',
      message: 'Operating threshold or confidence-sweep grid differs between reports.',
    });
  }
  if (left.benchmark.detector.runtime.backend !== right.benchmark.detector.runtime.backend) {
    findings.push({
      code: 'runtime_backend_differs', severity: 'warning',
      message: 'Execution backend differs; latency reflects model-plus-backend interaction rather than an isolated architecture effect.',
    });
  }

  const hasError = findings.some((finding) => finding.severity === 'error');
  const status: PairedBenchmarkComparabilityStatus = hasError
    ? 'invalid'
    : findings.length > 0 ? 'conditional' : 'strict';

  const leftBest = left.confidence?.sweep.bestObservedMacroF1?.macroF1;
  const rightBest = right.confidence?.sweep.bestObservedMacroF1?.macroF1;

  return {
    schemaVersion: '1',
    comparisonId,
    left: {
      runId: left.runId,
      modelId: left.benchmark.detector.model.modelId,
      modelSha256: left.benchmark.detector.model.modelSha256,
    },
    right: {
      runId: right.runId,
      modelId: right.benchmark.detector.model.modelId,
      modelSha256: right.benchmark.detector.model.modelSha256,
    },
    comparability: { status, findings },
    accuracy: {
      macroF1: delta(left.benchmark.macroF1, right.benchmark.macroF1),
      matchedIoUMean: delta(left.benchmark.matchedIoUMean, right.benchmark.matchedIoUMean),
      bestObservedMacroF1: leftBest === undefined || rightBest === undefined
        ? null
        : delta(leftBest, rightBest),
    },
    performance: {
      inferenceMsP50: delta(left.benchmark.latency.inferenceMsP50, right.benchmark.latency.inferenceMsP50),
      inferenceMsP95: delta(left.benchmark.latency.inferenceMsP95, right.benchmark.latency.inferenceMsP95),
      totalMsP50: delta(left.benchmark.latency.totalMsP50, right.benchmark.latency.totalMsP50),
      totalMsP95: delta(left.benchmark.latency.totalMsP95, right.benchmark.latency.totalMsP95),
      effectiveInferenceFps: delta(left.benchmark.latency.effectiveInferenceFps, right.benchmark.latency.effectiveInferenceFps),
      latencyDriftRatio: delta(left.benchmark.latency.latencyDriftRatio, right.benchmark.latency.latencyDriftRatio),
    },
    classes: compareClasses(left, right),
  };
}

export function serializePairedDetectorBenchmarkComparison(
  comparison: PairedDetectorBenchmarkComparison,
): string {
  return `${JSON.stringify(comparison, null, 2)}\n`;
}
