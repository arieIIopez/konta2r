import type { RawDetection } from '../core/types';
import { aggregateDetectorAccuracy } from './benchmark';
import type { AnnotatedBenchmarkFrame } from './benchmarkDataset';
import { evaluateDetectionsAgainstGroundTruth } from './groundTruthMatching';
import type { DetectorAccuracyObservation, DetectorClassMetrics } from './types';

export const DEFAULT_CONFIDENCE_SWEEP_THRESHOLDS: readonly number[] = [
  0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50,
  0.55, 0.60, 0.65, 0.70, 0.75, 0.80, 0.85, 0.90, 0.95,
];

export interface ConfidenceSweepPoint {
  threshold: number;
  classMetrics: DetectorClassMetrics[];
  macroF1: number;
}

export interface ObservedBestClassThreshold {
  className: string;
  threshold: number;
  precision: number;
  recall: number;
  f1: number;
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
}

export interface ConfidenceSweepResult {
  schemaVersion: '1';
  iouThreshold: number;
  thresholds: number[];
  points: ConfidenceSweepPoint[];
  bestObservedMacroF1: {
    threshold: number;
    macroF1: number;
  } | null;
  bestObservedByClass: ObservedBestClassThreshold[];
}

export interface ConfidenceSweepOptions {
  thresholds?: readonly number[];
  iouThreshold?: number;
}

function normalizedThresholds(values: readonly number[] | undefined): number[] {
  const source = values ?? DEFAULT_CONFIDENCE_SWEEP_THRESHOLDS;
  if (source.length === 0) throw new Error('confidence sweep requires at least one threshold');
  const result = [...new Set(source.map((value) => {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error('confidence sweep thresholds must be within [0, 1]');
    }
    return value;
  }))].sort((a, b) => a - b);
  return result;
}

function normalizeIou(value: number | undefined): number {
  const threshold = value ?? 0.5;
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1) {
    throw new Error('confidence sweep IoU threshold must be within (0, 1]');
  }
  return threshold;
}

function macroF1(metrics: readonly DetectorClassMetrics[]): number {
  return metrics.length === 0
    ? 0
    : metrics.reduce((sum, metric) => sum + metric.f1, 0) / metrics.length;
}

function betterClassPoint(
  candidate: ObservedBestClassThreshold,
  incumbent: ObservedBestClassThreshold | undefined,
): boolean {
  if (!incumbent) return true;
  if (candidate.f1 !== incumbent.f1) return candidate.f1 > incumbent.f1;
  if (candidate.precision !== incumbent.precision) return candidate.precision > incumbent.precision;
  return candidate.threshold > incumbent.threshold;
}

/**
 * Evaluates already-decoded detections at multiple confidence thresholds without
 * re-running inference. The detector must retain detections down to at least the
 * minimum requested threshold; this class cannot recover detections filtered by
 * the adapter before evaluation.
 */
export class ConfidenceSweepAccumulator {
  private readonly thresholds: number[];
  private readonly iouThreshold: number;
  private readonly observations = new Map<number, DetectorAccuracyObservation[]>();

  constructor(options: ConfidenceSweepOptions = {}) {
    this.thresholds = normalizedThresholds(options.thresholds);
    this.iouThreshold = normalizeIou(options.iouThreshold);
    for (const threshold of this.thresholds) this.observations.set(threshold, []);
  }

  minimumThreshold(): number {
    return this.thresholds[0] ?? 0;
  }

  addFrame(frame: AnnotatedBenchmarkFrame, detections: readonly RawDetection[]): void {
    for (const threshold of this.thresholds) {
      const filtered = detections.filter((detection) => detection.confidence >= threshold);
      const evaluation = evaluateDetectionsAgainstGroundTruth(
        filtered,
        frame.objects,
        frame.height,
        { iouThreshold: this.iouThreshold },
      );
      this.observations.get(threshold)?.push(...evaluation.accuracyObservations);
    }
  }

  finalize(): ConfidenceSweepResult {
    const points = this.thresholds.map((threshold): ConfidenceSweepPoint => {
      const classMetrics = aggregateDetectorAccuracy(this.observations.get(threshold) ?? []);
      return {
        threshold,
        classMetrics: classMetrics.map((metric) => ({ ...metric })),
        macroF1: macroF1(classMetrics),
      };
    });

    const bestObservedMacroF1 = points.length === 0
      ? null
      : points.reduce((best, point) => (
          point.macroF1 > best.macroF1
          || (point.macroF1 === best.macroF1 && point.threshold > best.threshold)
            ? { threshold: point.threshold, macroF1: point.macroF1 }
            : best
        ), { threshold: points[0]?.threshold ?? 0, macroF1: points[0]?.macroF1 ?? 0 });

    const perClass = new Map<string, ObservedBestClassThreshold>();
    for (const point of points) {
      for (const metric of point.classMetrics) {
        const candidate: ObservedBestClassThreshold = {
          className: metric.className,
          threshold: point.threshold,
          precision: metric.precision,
          recall: metric.recall,
          f1: metric.f1,
          truePositive: metric.truePositive,
          falsePositive: metric.falsePositive,
          falseNegative: metric.falseNegative,
        };
        if (betterClassPoint(candidate, perClass.get(metric.className))) {
          perClass.set(metric.className, candidate);
        }
      }
    }

    return {
      schemaVersion: '1',
      iouThreshold: this.iouThreshold,
      thresholds: [...this.thresholds],
      points,
      bestObservedMacroF1,
      bestObservedByClass: [...perClass.values()].sort((a, b) => a.className.localeCompare(b.className)),
    };
  }
}
