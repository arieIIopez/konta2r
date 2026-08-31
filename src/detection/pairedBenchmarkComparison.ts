import type { DetectorClassMetrics } from './types';
import type { DetectorBenchmarkReport } from './benchmarkReport';

export type BenchmarkComparability = 'comparable' | 'provisional' | 'incompatible';

export interface ComparabilityFinding {
  code: string;
  severity: 'warning' | 'error';
  detail: string;
}

export interface BenchmarkComparisonGate {
  status: BenchmarkComparability;
  findings: ComparabilityFinding[];
}

export interface PairedClassAccuracyDelta {
  className: string;
  left?: DetectorClassMetrics;
  right?: DetectorClassMetrics;
  precisionDelta?: number;
  recallDelta?: number;
  f1Delta?: number;
}

export interface OperatingPointComparison {
  gate: BenchmarkComparisonGate;
  confidenceThreshold?: number;
  macroF1Delta?: number;
  matchedIoUMeanDelta?: number;
  byClass: PairedClassAccuracyDelta[];
}

export interface ConfidenceSweepDeltaPoint {
  threshold: number;
  leftMacroF1: number;
  rightMacroF1: number;
  macroF1Delta: number;
}

export interface ConfidenceSweepComparison {
  gate: BenchmarkComparisonGate;
  points: ConfidenceSweepDeltaPoint[];
  leftBestObserved?: { threshold: number; macroF1: number };
  rightBestObserved?: { threshold: number; macroF1: number };
}

export interface PerformanceComparison {
  gate: BenchmarkComparisonGate;
  totalMsP50RatioRightToLeft?: number;
  totalMsP95RatioRightToLeft?: number;
  inferenceMsP50RatioRightToLeft?: number;
  inferenceMsP95RatioRightToLeft?: number;
  effectiveInferenceFpsRatioRightToLeft?: number;
  latencyDriftDelta?: number;
}

export interface PairedDetectorBenchmarkComparison {
  schemaVersion: '1';
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
  corpusGate: BenchmarkComparisonGate;
  operatingPoint: OperatingPointComparison;
  confidenceSweep: ConfidenceSweepComparison;
  performance: PerformanceComparison;
}

function close(a: number, b: number, tolerance = 1e-12): boolean {
  return Math.abs(a - b) <= tolerance;
}

function sameOptional<T>(left: T | undefined, right: T | undefined): boolean {
  return left === undefined || right === undefined || left === right;
}

function statusFor(findings: readonly ComparabilityFinding[]): BenchmarkComparability {
  if (findings.some((finding) => finding.severity === 'error')) return 'incompatible';
  if (findings.length > 0) return 'provisional';
  return 'comparable';
}

function gate(findings: ComparabilityFinding[]): BenchmarkComparisonGate {
  return { status: statusFor(findings), findings };
}

function error(code: string, detail: string): ComparabilityFinding {
  return { code, severity: 'error', detail };
}

function warning(code: string, detail: string): ComparabilityFinding {
  return { code, severity: 'warning', detail };
}

function arraysEqual<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameScaleThresholds(left: DetectorBenchmarkReport, right: DetectorBenchmarkReport): boolean {
  const a = left.benchmark.matching.imageScaleThresholds;
  const b = right.benchmark.matching.imageScaleThresholds;
  return close(a.smallMaxHeightRatio, b.smallMaxHeightRatio)
    && close(a.mediumMaxHeightRatio, b.mediumMaxHeightRatio);
}

function corpusFindings(left: DetectorBenchmarkReport, right: DetectorBenchmarkReport): ComparabilityFinding[] {
  const findings: ComparabilityFinding[] = [];
  if (left.corpus.datasetId !== right.corpus.datasetId) {
    findings.push(error('dataset_id_mismatch', 'Los reportes declaran datasetId distintos.'));
  }
  if (!arraysEqual(left.corpus.sequenceIds, right.corpus.sequenceIds)) {
    findings.push(error('sequence_identity_mismatch', 'Las secuencias o su orden no coinciden.'));
  }
  if (left.corpus.frameCount !== right.corpus.frameCount) {
    findings.push(error('frame_count_mismatch', 'Los reportes no evaluaron el mismo número de frames.'));
  }
  if (!close(left.benchmark.matching.iouThreshold, right.benchmark.matching.iouThreshold)) {
    findings.push(error('matching_iou_mismatch', 'El IoU de matching no coincide.'));
  }
  if (!sameScaleThresholds(left, right)) {
    findings.push(error('image_scale_threshold_mismatch', 'Los umbrales de escala aparente no coinciden.'));
  }

  const leftManifest = left.corpus.manifest;
  const rightManifest = right.corpus.manifest;
  if (leftManifest || rightManifest) {
    if (!leftManifest || !rightManifest) {
      findings.push(error('manifest_identity_missing', 'Solo uno de los reportes está vinculado a un manifest congelado.'));
    } else if (
      leftManifest.sha256 !== rightManifest.sha256
      || leftManifest.corpusId !== rightManifest.corpusId
      || leftManifest.split !== rightManifest.split
    ) {
      findings.push(error('manifest_identity_mismatch', 'Los reportes no provienen del mismo manifest/split congelado.'));
    }
  } else {
    findings.push(warning('manifest_identity_unproven', 'Ningún reporte incluye identidad de manifest congelado.'));
  }

  const hashPairs: Array<[string, string | undefined, string | undefined]> = [
    ['annotation', left.corpus.annotationSha256, right.corpus.annotationSha256],
    ['media', left.corpus.mediaSha256, right.corpus.mediaSha256],
  ];
  for (const [label, a, b] of hashPairs) {
    if (a === undefined && b === undefined) {
      findings.push(warning(`${label}_hash_unproven`, `No se registró SHA-256 de ${label} en ninguno de los reportes.`));
    } else if (a === undefined || b === undefined) {
      findings.push(error(`${label}_hash_missing`, `Solo uno de los reportes registra SHA-256 de ${label}.`));
    } else if (a !== b) {
      findings.push(error(`${label}_hash_mismatch`, `Los SHA-256 de ${label} no coinciden.`));
    }
  }

  const leftFrames = left.benchmark.frames;
  const rightFrames = right.benchmark.frames;
  if (leftFrames.length !== rightFrames.length) {
    findings.push(error('frame_records_mismatch', 'El número de registros de frame difiere.'));
  } else {
    for (let index = 0; index < leftFrames.length; index += 1) {
      const a = leftFrames[index];
      const b = rightFrames[index];
      if (!a || !b) continue;
      if (a.frameId !== b.frameId || !close(a.timestampMs, b.timestampMs, 1e-6)) {
        findings.push(error('frame_identity_mismatch', `Frame distinto en posición ${index}: ${a.frameId} vs ${b.frameId}.`));
        break;
      }
      if (!sameOptional(a.mediaTimeMs, b.mediaTimeMs)) {
        findings.push(error('media_time_mismatch', `mediaTimeMs no coincide en frame ${a.frameId}.`));
        break;
      }
    }
  }
  return findings;
}

function operatingThresholdFindings(
  left: DetectorBenchmarkReport,
  right: DetectorBenchmarkReport,
): ComparabilityFinding[] {
  if (!left.confidence || !right.confidence) {
    return [warning(
      'operating_threshold_unproven',
      'Ambos reportes deben registrar operatingConfidenceThreshold para comparar métricas del punto operativo.',
    )];
  }
  if (!close(left.confidence.operatingConfidenceThreshold, right.confidence.operatingConfidenceThreshold)) {
    return [error('operating_threshold_mismatch', 'Los puntos operativos usan thresholds de confianza distintos.')];
  }
  return [];
}

function classMap(report: DetectorBenchmarkReport): Map<string, DetectorClassMetrics> {
  return new Map(report.benchmark.classMetrics.map((metric) => [metric.className, metric]));
}

function classDeltas(left: DetectorBenchmarkReport, right: DetectorBenchmarkReport): PairedClassAccuracyDelta[] {
  const leftMap = classMap(left);
  const rightMap = classMap(right);
  const classNames = [...new Set([...leftMap.keys(), ...rightMap.keys()])].sort();
  return classNames.map((className) => {
    const a = leftMap.get(className);
    const b = rightMap.get(className);
    return {
      className,
      ...(a === undefined ? {} : { left: { ...a } }),
      ...(b === undefined ? {} : { right: { ...b } }),
      ...(a === undefined || b === undefined
        ? {}
        : {
            precisionDelta: b.precision - a.precision,
            recallDelta: b.recall - a.recall,
            f1Delta: b.f1 - a.f1,
          }),
    };
  });
}

function sweepFindings(left: DetectorBenchmarkReport, right: DetectorBenchmarkReport): ComparabilityFinding[] {
  if (!left.confidence || !right.confidence) {
    return [warning('confidence_sweep_missing', 'Ambos reportes necesitan un confidence sweep para comparación threshold-neutral.')];
  }
  const a = left.confidence.sweep;
  const b = right.confidence.sweep;
  const findings: ComparabilityFinding[] = [];
  if (!close(a.iouThreshold, b.iouThreshold)) {
    findings.push(error('sweep_iou_mismatch', 'Los confidence sweeps usan IoU distintos.'));
  }
  if (!arraysEqual(a.thresholds, b.thresholds)) {
    findings.push(error('sweep_thresholds_mismatch', 'Los confidence sweeps no evaluaron exactamente los mismos thresholds.'));
  }
  return findings;
}

function sweepPoints(left: DetectorBenchmarkReport, right: DetectorBenchmarkReport): ConfidenceSweepDeltaPoint[] {
  if (!left.confidence || !right.confidence) return [];
  const rightByThreshold = new Map(right.confidence.sweep.points.map((point) => [point.threshold, point]));
  return left.confidence.sweep.points.flatMap((point) => {
    const other = rightByThreshold.get(point.threshold);
    return other
      ? [{
          threshold: point.threshold,
          leftMacroF1: point.macroF1,
          rightMacroF1: other.macroF1,
          macroF1Delta: other.macroF1 - point.macroF1,
        }]
      : [];
  });
}

function performanceFindings(left: DetectorBenchmarkReport, right: DetectorBenchmarkReport): ComparabilityFinding[] {
  const findings: ComparabilityFinding[] = [];
  if (left.device.label !== right.device.label) {
    findings.push(error('device_label_mismatch', 'Los reportes declaran dispositivos/perfiles distintos.'));
  }
  const sharedChecks: Array<[string, unknown, unknown]> = [
    ['user_agent', left.device.userAgent, right.device.userAgent],
    ['hardware_concurrency', left.device.hardwareConcurrency, right.device.hardwareConcurrency],
    ['device_memory', left.device.deviceMemoryGiB, right.device.deviceMemoryGiB],
    ['webgpu_available', left.device.webgpuAvailable, right.device.webgpuAvailable],
  ];
  let evidenceFields = 0;
  for (const [name, a, b] of sharedChecks) {
    if (a === undefined && b === undefined) continue;
    if (a === undefined || b === undefined) {
      findings.push(warning(`${name}_incomplete`, `La identidad de dispositivo ${name} está presente solo en un reporte.`));
      continue;
    }
    evidenceFields += 1;
    if (a !== b) findings.push(error(`${name}_mismatch`, `La identidad de dispositivo ${name} no coincide.`));
  }
  if (evidenceFields < 2) {
    findings.push(warning(
      'device_identity_weak',
      'La etiqueta de dispositivo por sí sola no demuestra que las corridas ocurrieron en hardware comparable.',
    ));
  }
  return findings;
}

function safeRatio(numerator: number, denominator: number): number | undefined {
  return denominator > 0 && Number.isFinite(numerator) && Number.isFinite(denominator)
    ? numerator / denominator
    : undefined;
}

export function compareDetectorBenchmarkReports(
  left: DetectorBenchmarkReport,
  right: DetectorBenchmarkReport,
): PairedDetectorBenchmarkComparison {
  const sharedCorpusFindings = corpusFindings(left, right);
  const corpusGate = gate(sharedCorpusFindings);

  const operatingFindings = [...sharedCorpusFindings, ...operatingThresholdFindings(left, right)];
  const operatingGate = gate(operatingFindings);
  const operatingThreshold = (
    left.confidence
    && right.confidence
    && close(left.confidence.operatingConfidenceThreshold, right.confidence.operatingConfidenceThreshold)
  ) ? left.confidence.operatingConfidenceThreshold : undefined;

  const sweepGate = gate([...sharedCorpusFindings, ...sweepFindings(left, right)]);
  const leftBest = left.confidence?.sweep.bestObservedMacroF1 ?? undefined;
  const rightBest = right.confidence?.sweep.bestObservedMacroF1 ?? undefined;

  const performanceGate = gate([
    ...sharedCorpusFindings,
    ...operatingThresholdFindings(left, right),
    ...performanceFindings(left, right),
  ]);
  const leftLatency = left.benchmark.latency;
  const rightLatency = right.benchmark.latency;

  return {
    schemaVersion: '1',
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
    corpusGate,
    operatingPoint: {
      gate: operatingGate,
      ...(operatingThreshold === undefined ? {} : { confidenceThreshold: operatingThreshold }),
      ...(operatingGate.status === 'incompatible'
        ? {}
        : {
            macroF1Delta: right.benchmark.macroF1 - left.benchmark.macroF1,
            matchedIoUMeanDelta: right.benchmark.matchedIoUMean - left.benchmark.matchedIoUMean,
          }),
      byClass: classDeltas(left, right),
    },
    confidenceSweep: {
      gate: sweepGate,
      points: sweepGate.status === 'incompatible' ? [] : sweepPoints(left, right),
      ...(leftBest === undefined ? {} : { leftBestObserved: { ...leftBest } }),
      ...(rightBest === undefined ? {} : { rightBestObserved: { ...rightBest } }),
    },
    performance: {
      gate: performanceGate,
      ...(performanceGate.status === 'incompatible'
        ? {}
        : {
            ...(safeRatio(rightLatency.totalMsP50, leftLatency.totalMsP50) === undefined
              ? {}
              : { totalMsP50RatioRightToLeft: safeRatio(rightLatency.totalMsP50, leftLatency.totalMsP50) as number }),
            ...(safeRatio(rightLatency.totalMsP95, leftLatency.totalMsP95) === undefined
              ? {}
              : { totalMsP95RatioRightToLeft: safeRatio(rightLatency.totalMsP95, leftLatency.totalMsP95) as number }),
            ...(safeRatio(rightLatency.inferenceMsP50, leftLatency.inferenceMsP50) === undefined
              ? {}
              : { inferenceMsP50RatioRightToLeft: safeRatio(rightLatency.inferenceMsP50, leftLatency.inferenceMsP50) as number }),
            ...(safeRatio(rightLatency.inferenceMsP95, leftLatency.inferenceMsP95) === undefined
              ? {}
              : { inferenceMsP95RatioRightToLeft: safeRatio(rightLatency.inferenceMsP95, leftLatency.inferenceMsP95) as number }),
            ...(safeRatio(rightLatency.effectiveInferenceFps, leftLatency.effectiveInferenceFps) === undefined
              ? {}
              : { effectiveInferenceFpsRatioRightToLeft: safeRatio(rightLatency.effectiveInferenceFps, leftLatency.effectiveInferenceFps) as number }),
            latencyDriftDelta: rightLatency.latencyDriftRatio - leftLatency.latencyDriftRatio,
          }),
    },
  };
}
