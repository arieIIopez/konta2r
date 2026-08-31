import type { AnnotatedDetectorBenchmarkResult, RecallStratum } from './annotatedBenchmark';
import type { BenchmarkManifestIdentity } from './benchmarkManifestLink';
import { CORPUS_SPLITS } from './corpusManifest';
import type {
  ConfidenceSweepPoint,
  ConfidenceSweepResult,
  ObservedBestClassThreshold,
} from './confidenceSweep';

export interface BenchmarkCorpusIdentity {
  datasetId: string;
  sequenceIds: string[];
  frameCount: number;
  annotationSha256?: string;
  mediaSha256?: string;
  /** Verified link to a separately hashed, frozen multi-sequence manifest. */
  manifest?: BenchmarkManifestIdentity;
}

export interface BenchmarkDeviceIdentity {
  label: string;
  userAgent?: string;
  hardwareConcurrency?: number;
  deviceMemoryGiB?: number;
  webgpuAvailable?: boolean;
}

export interface BenchmarkConfidenceAnalysis {
  operatingConfidenceThreshold: number;
  sweep: ConfidenceSweepResult;
}

export interface DetectorBenchmarkReport {
  schemaVersion: '1';
  runId: string;
  createdAtIso: string;
  corpus: BenchmarkCorpusIdentity;
  device: BenchmarkDeviceIdentity;
  benchmark: AnnotatedDetectorBenchmarkResult;
  confidence?: BenchmarkConfidenceAnalysis;
  notes?: string[];
}

export interface BenchmarkReportInput {
  runId: string;
  createdAtIso?: string;
  corpus: BenchmarkCorpusIdentity;
  device: BenchmarkDeviceIdentity;
  benchmark: AnnotatedDetectorBenchmarkResult;
  confidence?: BenchmarkConfidenceAnalysis;
  notes?: readonly string[];
}

function cloneRecallStrata(values: readonly RecallStratum[]): RecallStratum[] {
  return values.map((value) => ({ ...value }));
}

function cloneSweepPoint(point: ConfidenceSweepPoint): ConfidenceSweepPoint {
  return {
    threshold: point.threshold,
    macroF1: point.macroF1,
    classMetrics: point.classMetrics.map((metric) => ({ ...metric })),
  };
}

function cloneBestClass(value: ObservedBestClassThreshold): ObservedBestClassThreshold {
  return { ...value };
}

function cloneConfidenceAnalysis(value: BenchmarkConfidenceAnalysis): BenchmarkConfidenceAnalysis {
  return {
    operatingConfidenceThreshold: value.operatingConfidenceThreshold,
    sweep: {
      schemaVersion: '1',
      iouThreshold: value.sweep.iouThreshold,
      thresholds: [...value.sweep.thresholds],
      points: value.sweep.points.map(cloneSweepPoint),
      bestObservedMacroF1: value.sweep.bestObservedMacroF1
        ? { ...value.sweep.bestObservedMacroF1 }
        : null,
      bestObservedByClass: value.sweep.bestObservedByClass.map(cloneBestClass),
    },
  };
}

function assertSha256IfPresent(value: string | undefined, label: string): void {
  if (value === undefined) return;
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error(`${label} must be a SHA-256 hex digest`);
}

function assertManifestIdentity(value: BenchmarkManifestIdentity | undefined): void {
  if (value === undefined) return;
  if (value.corpusId.trim().length === 0) throw new Error('manifest corpusId is required');
  assertSha256IfPresent(value.sha256, 'manifestSha256');
  if (!CORPUS_SPLITS.includes(value.split)) throw new Error(`Unsupported manifest corpus split ${value.split}`);
}

function assertConfidenceAnalysis(
  confidence: BenchmarkConfidenceAnalysis | undefined,
  benchmark: AnnotatedDetectorBenchmarkResult,
): void {
  if (!confidence) return;
  if (!Number.isFinite(confidence.operatingConfidenceThreshold)
    || confidence.operatingConfidenceThreshold < 0
    || confidence.operatingConfidenceThreshold > 1) {
    throw new Error('operatingConfidenceThreshold must be within [0, 1]');
  }
  if (Math.abs(confidence.sweep.iouThreshold - benchmark.matching.iouThreshold) > 1e-12) {
    throw new Error('confidence sweep IoU must match benchmark matching IoU');
  }
}

export function createDetectorBenchmarkReport(input: BenchmarkReportInput): DetectorBenchmarkReport {
  if (input.runId.trim().length === 0) throw new Error('runId is required');
  if (input.corpus.datasetId.trim().length === 0) throw new Error('corpus datasetId is required');
  if (input.corpus.sequenceIds.length === 0) throw new Error('At least one corpus sequenceId is required');
  if (input.corpus.sequenceIds.some((value) => value.trim().length === 0)) throw new Error('Corpus sequenceIds cannot be empty');
  if (!Number.isInteger(input.corpus.frameCount) || input.corpus.frameCount < 0) throw new Error('Corpus frameCount must be a non-negative integer');
  if (input.corpus.frameCount !== input.benchmark.frameCount) {
    throw new Error('Corpus frameCount must match benchmark frameCount');
  }
  if (input.device.label.trim().length === 0) throw new Error('device label is required');
  assertSha256IfPresent(input.corpus.annotationSha256, 'annotationSha256');
  assertSha256IfPresent(input.corpus.mediaSha256, 'mediaSha256');
  assertManifestIdentity(input.corpus.manifest);
  assertConfidenceAnalysis(input.confidence, input.benchmark);

  const createdAtIso = input.createdAtIso ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(createdAtIso))) throw new Error('createdAtIso must be a valid ISO date');

  return {
    schemaVersion: '1',
    runId: input.runId,
    createdAtIso,
    corpus: {
      datasetId: input.corpus.datasetId,
      sequenceIds: [...input.corpus.sequenceIds],
      frameCount: input.corpus.frameCount,
      ...(input.corpus.annotationSha256 === undefined ? {} : { annotationSha256: input.corpus.annotationSha256.toLowerCase() }),
      ...(input.corpus.mediaSha256 === undefined ? {} : { mediaSha256: input.corpus.mediaSha256.toLowerCase() }),
      ...(input.corpus.manifest === undefined
        ? {}
        : {
            manifest: {
              corpusId: input.corpus.manifest.corpusId,
              sha256: input.corpus.manifest.sha256.toLowerCase(),
              split: input.corpus.manifest.split,
            },
          }),
    },
    device: { ...input.device },
    benchmark: {
      ...input.benchmark,
      detector: {
        model: {
          ...input.benchmark.detector.model,
          classNames: [...input.benchmark.detector.model.classNames],
        },
        runtime: {
          ...input.benchmark.detector.runtime,
          executionProviders: [...input.benchmark.detector.runtime.executionProviders],
        },
      },
      latency: { ...input.benchmark.latency },
      classMetrics: input.benchmark.classMetrics.map((metric) => ({ ...metric })),
      ...(input.benchmark.mediaSeek === undefined ? {} : { mediaSeek: { ...input.benchmark.mediaSeek } }),
      matching: {
        iouThreshold: input.benchmark.matching.iouThreshold,
        imageScaleThresholds: { ...input.benchmark.matching.imageScaleThresholds },
      },
      recallByImageScale: cloneRecallStrata(input.benchmark.recallByImageScale),
      recallByOcclusion: cloneRecallStrata(input.benchmark.recallByOcclusion),
      frames: input.benchmark.frames.map((frame) => ({
        ...frame,
        matches: frame.matches.map((match) => ({ ...match })),
      })),
    },
    ...(input.confidence === undefined ? {} : { confidence: cloneConfidenceAnalysis(input.confidence) }),
    ...(input.notes === undefined ? {} : { notes: [...input.notes] }),
  };
}

export function serializeDetectorBenchmarkReport(report: DetectorBenchmarkReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

function csvEscape(value: string | number | boolean | undefined): string {
  if (value === undefined) return '';
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvRow(values: readonly (string | number | boolean | undefined)[]): string {
  return values.map(csvEscape).join(',');
}

export function detectorBenchmarkSummaryCsv(report: DetectorBenchmarkReport): string {
  const header = [
    'runId', 'createdAtIso', 'datasetId', 'manifestCorpusId', 'manifestSha256', 'corpusSplit',
    'device', 'modelId', 'modelVersion', 'modelSha256',
    'backend', 'runtime', 'runtimeVersion', 'iouThreshold', 'operatingConfidenceThreshold',
    'bestObservedMacroF1Threshold', 'bestObservedMacroF1', 'frameCount', 'className',
    'tp', 'fp', 'fn', 'precision', 'recall', 'f1', 'macroF1', 'matchedIoUMean',
    'totalMsP50', 'totalMsP95', 'inferenceMsP50', 'inferenceMsP95', 'effectiveInferenceFps',
    'latencyDriftRatio', 'seekSampleCount', 'seekAbsErrorMeanMs', 'seekAbsErrorMaxMs',
  ];
  const rows = report.benchmark.classMetrics.map((metric) => csvRow([
    report.runId,
    report.createdAtIso,
    report.corpus.datasetId,
    report.corpus.manifest?.corpusId,
    report.corpus.manifest?.sha256,
    report.corpus.manifest?.split,
    report.device.label,
    report.benchmark.detector.model.modelId,
    report.benchmark.detector.model.modelVersion,
    report.benchmark.detector.model.modelSha256,
    report.benchmark.detector.runtime.backend,
    report.benchmark.detector.runtime.runtime,
    report.benchmark.detector.runtime.runtimeVersion,
    report.benchmark.matching.iouThreshold,
    report.confidence?.operatingConfidenceThreshold,
    report.confidence?.sweep.bestObservedMacroF1?.threshold,
    report.confidence?.sweep.bestObservedMacroF1?.macroF1,
    report.benchmark.frameCount,
    metric.className,
    metric.truePositive,
    metric.falsePositive,
    metric.falseNegative,
    metric.precision,
    metric.recall,
    metric.f1,
    report.benchmark.macroF1,
    report.benchmark.matchedIoUMean,
    report.benchmark.latency.totalMsP50,
    report.benchmark.latency.totalMsP95,
    report.benchmark.latency.inferenceMsP50,
    report.benchmark.latency.inferenceMsP95,
    report.benchmark.latency.effectiveInferenceFps,
    report.benchmark.latency.latencyDriftRatio,
    report.benchmark.mediaSeek?.sampleCount,
    report.benchmark.mediaSeek?.absoluteErrorMeanMs,
    report.benchmark.mediaSeek?.absoluteErrorMaxMs,
  ]));
  return `${[csvRow(header), ...rows].join('\n')}\n`;
}

function stratumRows(
  report: DetectorBenchmarkReport,
  dimension: 'image_scale' | 'occlusion',
  strata: readonly RecallStratum[],
): string[] {
  return strata.map((stratum) => csvRow([
    report.runId,
    report.corpus.datasetId,
    report.corpus.manifest?.corpusId,
    report.corpus.manifest?.sha256,
    report.corpus.manifest?.split,
    report.device.label,
    report.benchmark.detector.model.modelId,
    dimension,
    stratum.className,
    stratum.value,
    stratum.groundTruthCount,
    stratum.truePositive,
    stratum.falseNegative,
    stratum.recall,
  ]));
}

export function detectorBenchmarkStrataCsv(report: DetectorBenchmarkReport): string {
  const header = [
    'runId', 'datasetId', 'manifestCorpusId', 'manifestSha256', 'corpusSplit',
    'device', 'modelId', 'dimension', 'className', 'stratum',
    'groundTruthCount', 'tp', 'fn', 'recall',
  ];
  return `${[
    csvRow(header),
    ...stratumRows(report, 'image_scale', report.benchmark.recallByImageScale),
    ...stratumRows(report, 'occlusion', report.benchmark.recallByOcclusion),
  ].join('\n')}\n`;
}

export function detectorBenchmarkConfidenceSweepCsv(report: DetectorBenchmarkReport): string {
  const confidence = report.confidence;
  const header = [
    'runId', 'datasetId', 'manifestCorpusId', 'manifestSha256', 'corpusSplit',
    'device', 'modelId', 'iouThreshold', 'threshold', 'className',
    'tp', 'fp', 'fn', 'precision', 'recall', 'f1', 'macroF1', 'operatingPoint',
  ];
  if (!confidence) return `${csvRow(header)}\n`;
  const rows: string[] = [];
  for (const point of confidence.sweep.points) {
    for (const metric of point.classMetrics) {
      rows.push(csvRow([
        report.runId,
        report.corpus.datasetId,
        report.corpus.manifest?.corpusId,
        report.corpus.manifest?.sha256,
        report.corpus.manifest?.split,
        report.device.label,
        report.benchmark.detector.model.modelId,
        confidence.sweep.iouThreshold,
        point.threshold,
        metric.className,
        metric.truePositive,
        metric.falsePositive,
        metric.falseNegative,
        metric.precision,
        metric.recall,
        metric.f1,
        point.macroF1,
        Math.abs(point.threshold - confidence.operatingConfidenceThreshold) <= 1e-12,
      ]));
    }
  }
  return `${[csvRow(header), ...rows].join('\n')}\n`;
}
