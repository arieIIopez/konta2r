import { describe, expect, it } from 'vitest';
import {
  aggregateDetectorAccuracy,
  summarizeDetectorLatency,
} from '../../src/detection/benchmark';

function telemetry(totalMs: number, inferenceMs = totalMs * 0.8) {
  return {
    preprocessMs: totalMs * 0.1,
    inferenceMs,
    postprocessMs: totalMs * 0.1,
    totalMs,
    detectionCountBeforeFiltering: 20,
    detectionCount: 15,
  };
}

describe('detector benchmark utilities', () => {
  it('reports p50/p95 and effective inference FPS', () => {
    const summary = summarizeDetectorLatency([
      { telemetry: telemetry(50), detectionCount: 10 },
      { telemetry: telemetry(60), detectionCount: 10 },
      { telemetry: telemetry(70), detectionCount: 10 },
      { telemetry: telemetry(80), detectionCount: 10 },
      { telemetry: telemetry(100), detectionCount: 10 },
    ]);

    expect(summary.totalMsP50).toBe(70);
    expect(summary.totalMsP95).toBe(100);
    expect(summary.effectiveInferenceFps).toBeCloseTo(1000 / 72);
  });

  it('detects sustained latency degradation between first and second half', () => {
    const summary = summarizeDetectorLatency([
      { telemetry: telemetry(100), detectionCount: 10 },
      { telemetry: telemetry(105), detectionCount: 10 },
      { telemetry: telemetry(150), detectionCount: 10 },
      { telemetry: telemetry(160), detectionCount: 10 },
    ]);

    expect(summary.firstHalfMedianMs).toBe(100);
    expect(summary.secondHalfMedianMs).toBe(150);
    expect(summary.latencyDriftRatio).toBe(0.5);
  });

  it('aggregates precision, recall and F1 per mobility-relevant class', () => {
    const metrics = aggregateDetectorAccuracy([
      { className: 'person', truePositive: 80, falsePositive: 10, falseNegative: 20 },
      { className: 'person', truePositive: 10, falsePositive: 0, falseNegative: 0 },
      { className: 'bicycle', truePositive: 30, falsePositive: 5, falseNegative: 15 },
    ]);

    const person = metrics.find((item) => item.className === 'person');
    expect(person?.truePositive).toBe(90);
    expect(person?.precision).toBe(0.9);
    expect(person?.recall).toBeCloseTo(90 / 110);
    expect(person?.f1).toBeGreaterThan(0.85);
  });
});
