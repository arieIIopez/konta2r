import type {
  DetectorAccuracyObservation,
  DetectorClassMetrics,
  DetectorOutput,
  DetectorTelemetry,
} from './types';

export interface DetectorBenchmarkSample {
  telemetry: DetectorTelemetry;
  detectionCount: number;
}

export interface DetectorLatencySummary {
  sampleCount: number;
  totalMsMean: number;
  totalMsP50: number;
  totalMsP95: number;
  inferenceMsMean: number;
  inferenceMsP50: number;
  inferenceMsP95: number;
  effectiveInferenceFps: number;
  firstHalfMedianMs: number;
  secondHalfMedianMs: number;
  latencyDriftRatio: number;
}

export interface DetectorBenchmarkResult {
  latency: DetectorLatencySummary;
  classMetrics: DetectorClassMetrics[];
  macroF1: number;
}

function safeDivide(numerator: number, denominator: number): number {
  return denominator <= 0 ? 0 : numerator / denominator;
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * fraction) - 1),
  );
  return sorted[index] ?? 0;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function summarizeDetectorLatency(
  samples: readonly DetectorBenchmarkSample[],
): DetectorLatencySummary {
  const total = samples.map((sample) => sample.telemetry.totalMs);
  const inference = samples.map((sample) => sample.telemetry.inferenceMs);
  const split = Math.max(1, Math.floor(total.length / 2));
  const firstHalf = total.slice(0, split);
  const secondHalf = total.slice(split);
  const firstHalfMedianMs = percentile(firstHalf, 0.5);
  const secondHalfMedianMs = secondHalf.length > 0
    ? percentile(secondHalf, 0.5)
    : firstHalfMedianMs;
  const latencyDriftRatio = firstHalfMedianMs <= 0
    ? 0
    : (secondHalfMedianMs - firstHalfMedianMs) / firstHalfMedianMs;
  const totalMsMean = mean(total);

  return {
    sampleCount: samples.length,
    totalMsMean,
    totalMsP50: percentile(total, 0.5),
    totalMsP95: percentile(total, 0.95),
    inferenceMsMean: mean(inference),
    inferenceMsP50: percentile(inference, 0.5),
    inferenceMsP95: percentile(inference, 0.95),
    effectiveInferenceFps: totalMsMean <= 0 ? 0 : 1000 / totalMsMean,
    firstHalfMedianMs,
    secondHalfMedianMs,
    latencyDriftRatio,
  };
}

export function aggregateDetectorAccuracy(
  observations: readonly DetectorAccuracyObservation[],
): DetectorClassMetrics[] {
  const totals = new Map<string, DetectorAccuracyObservation>();

  for (const item of observations) {
    const previous = totals.get(item.className) ?? {
      className: item.className,
      truePositive: 0,
      falsePositive: 0,
      falseNegative: 0,
    };
    previous.truePositive += item.truePositive;
    previous.falsePositive += item.falsePositive;
    previous.falseNegative += item.falseNegative;
    totals.set(item.className, previous);
  }

  return [...totals.values()]
    .map((item) => {
      const precision = safeDivide(item.truePositive, item.truePositive + item.falsePositive);
      const recall = safeDivide(item.truePositive, item.truePositive + item.falseNegative);
      const f1 = safeDivide(2 * precision * recall, precision + recall);
      return { ...item, precision, recall, f1 };
    })
    .sort((a, b) => a.className.localeCompare(b.className));
}

export function buildDetectorBenchmarkResult(
  outputs: readonly DetectorOutput[],
  accuracyObservations: readonly DetectorAccuracyObservation[],
): DetectorBenchmarkResult {
  const classMetrics = aggregateDetectorAccuracy(accuracyObservations);
  return {
    latency: summarizeDetectorLatency(outputs.map((output) => ({
      telemetry: output.telemetry,
      detectionCount: output.detections.length,
    }))),
    classMetrics,
    macroF1: classMetrics.length === 0
      ? 0
      : classMetrics.reduce((sum, item) => sum + item.f1, 0) / classMetrics.length,
  };
}
