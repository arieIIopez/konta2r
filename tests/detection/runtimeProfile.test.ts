import { describe, expect, it } from 'vitest';
import type { DetectorLatencySummary } from '../../src/detection/benchmark';
import {
  recommendProfileFromLatency,
  recommendRuntime,
} from '../../src/detection/runtimeProfile';

function latency(p95: number, drift: number): DetectorLatencySummary {
  return {
    sampleCount: 100,
    totalMsMean: p95 * 0.8,
    totalMsP50: p95 * 0.7,
    totalMsP95: p95,
    inferenceMsMean: p95 * 0.65,
    inferenceMsP50: p95 * 0.6,
    inferenceMsP95: p95 * 0.85,
    effectiveInferenceFps: 1000 / (p95 * 0.8),
    firstHalfMedianMs: 100,
    secondHalfMedianMs: 100 * (1 + drift),
    latencyDriftRatio: drift,
  };
}

describe('edge runtime profile', () => {
  it('selects performance only for low p95 and low drift', () => {
    expect(recommendProfileFromLatency(latency(70, 0.1))).toBe('performance');
    expect(recommendProfileFromLatency(latency(70, 0.3))).toBe('balanced');
  });

  it('falls back to eco when sustained latency is high', () => {
    expect(recommendProfileFromLatency(latency(260, 0.1))).toBe('eco');
  });

  it('prefers WebGPU with WASM fallback when available', () => {
    const recommendation = recommendRuntime({
      webGpuAvailable: true,
      hardwareConcurrency: 8,
      deviceMemoryGb: 8,
    });

    expect(recommendation.executionProviders).toEqual(['webgpu', 'wasm']);
    expect(recommendation.profile.name).toBe('performance');
  });

  it('uses WASM and eco profile on constrained hardware', () => {
    const recommendation = recommendRuntime({
      webGpuAvailable: false,
      hardwareConcurrency: 2,
      deviceMemoryGb: 2,
    });

    expect(recommendation.executionProviders).toEqual(['wasm']);
    expect(recommendation.profile.name).toBe('eco');
  });

  it('downgrades from hardware heuristic when sustained benchmark degrades', () => {
    const recommendation = recommendRuntime(
      { webGpuAvailable: true, hardwareConcurrency: 8, deviceMemoryGb: 8 },
      latency(170, 0.4),
    );

    expect(recommendation.profile.name).toBe('eco');
    expect(recommendation.reasons.some((reason) => reason.includes('throttling'))).toBe(true);
  });
});
