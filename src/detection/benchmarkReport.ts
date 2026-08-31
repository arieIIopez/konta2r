import type { AnnotatedDetectorBenchmarkResult, RecallStratum } from './annotatedBenchmark';

export interface BenchmarkCorpusIdentity {
  datasetId: string;
  sequenceIds: string[];
  frameCount: number;
  annotationSha256?: string;
  mediaSha256?: string;
}

export interface BenchmarkDeviceIdentity {
  label: string;
  userAgent?: string;
  hardwareConcurrency?: number;
  deviceMemoryGiB?: number;
  webgpuAvailable?: boolean;
}

export interface DetectorBenchmarkReport {
  schemaVersion: '1';
  runId: string;
  createdAtIso: string;
  corpus: BenchmarkCorpusIdentity;
  device: BenchmarkDeviceIdentity;
  benchmark: AnnotatedDetectorBenchmarkResult;
  notes?: string[];
}

export interface BenchmarkReportInput {
  runId: string;
  createdAtIso?: string;
  corpus: BenchmarkCorpusIdentity;
  device: BenchmarkDeviceIdentity;
  benchmark: AnnotatedDetectorBenchmarkResult;
  notes?: readonly string[];
}

function cloneRecallStrata(values: readonly RecallStratum[]): RecallStratum[] {
  return values.map((value) => ({ ...value }));
}

function assertSha256IfPresent(value: string | undefined, label: string): void {
  if (value === undefined) return;
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error(`${label} must be a SHA-256 hex digest`);
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
    'runId', 'createdAtIso', 'datasetId', 'device', 'modelId', 'modelVersion', 'modelSha256',
    'backend', 'runtime', 'runtimeVersion', 'iouThreshold', 'frameCount', 'className',
    'tp', 'fp', 'fn', 'precision', 'recall', 'f1', 'macroF1', 'matchedIoUMean',
    'totalMsP50', 'totalMsP95', 'inferenceMsP50', 'inferenceMsP95', 'effectiveInferenceFps',
    'latencyDriftRatio', 'seekSampleCount', 'seekAbsErrorMeanMs', 'seekAbsErrorMaxMs',
  ];
  const rows = report.benchmark.classMetrics.map((metric) => csvRow([
    report.runId,
    report.createdAtIso,
    report.corpus.datasetId,
    report.device.label,
    report.benchmark.detector.model.modelId,
    report.benchmark.detector.model.modelVersion,
    report.benchmark.detector.model.modelSha256,
    report.benchmark.detector.runtime.backend,
    report.benchmark.detector.runtime.runtime,
    report.benchmark.detector.runtime.runtimeVersion,
    report.benchmark.matching.iouThreshold,
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
    'runId', 'datasetId', 'device', 'modelId', 'dimension', 'className', 'stratum',
    'groundTruthCount', 'tp', 'fn', 'recall',
  ];
  return `${[
    csvRow(header),
    ...stratumRows(report, 'image_scale', report.benchmark.recallByImageScale),
    ...stratumRows(report, 'occlusion', report.benchmark.recallByOcclusion),
  ].join('\n')}\n`;
}
