import type { RuntimePerformanceSnapshot } from './deviceProfile';

export type NodeLoadPressure = 'unknown' | 'nominal' | 'elevated' | 'critical';

export interface NodeHealthSnapshot extends RuntimePerformanceSnapshot {
  sampleCount: number;
  loadPressure: NodeLoadPressure;
  latencyDriftRatio: number;
}

export interface ProcessingSample {
  timestampMs: number;
  processingMs: number;
}

export interface NodeHealthMonitorOptions {
  windowMs?: number;
  expectedFps: number;
  maxSamples?: number;
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index] ?? 0;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Measures sustained processing pressure indirectly from latency and delivery
 * rate. It intentionally does not claim to measure device temperature.
 */
export class NodeHealthMonitor {
  private samples: ProcessingSample[] = [];
  private readonly windowMs: number;
  private expectedFps: number;
  private readonly maxSamples: number;

  constructor(options: NodeHealthMonitorOptions) {
    if (!(options.expectedFps > 0)) throw new Error('expectedFps must be greater than zero');
    this.windowMs = Math.max(5_000, options.windowMs ?? 60_000);
    this.expectedFps = options.expectedFps;
    this.maxSamples = Math.max(30, options.maxSamples ?? 2_000);
  }

  setExpectedFps(expectedFps: number): void {
    if (!(expectedFps > 0)) throw new Error('expectedFps must be greater than zero');
    this.expectedFps = expectedFps;
  }

  record(sample: ProcessingSample): void {
    if (!Number.isFinite(sample.timestampMs) || !Number.isFinite(sample.processingMs) || sample.processingMs < 0) {
      throw new Error('Processing sample must contain finite non-negative values');
    }
    this.samples.push({ ...sample });
    const cutoff = sample.timestampMs - this.windowMs;
    this.samples = this.samples
      .filter((item) => item.timestampMs >= cutoff)
      .slice(-this.maxSamples);
  }

  snapshot(nowMs: number): NodeHealthSnapshot {
    const cutoff = nowMs - this.windowMs;
    const samples = this.samples.filter((sample) => sample.timestampMs >= cutoff);
    if (samples.length === 0) {
      return {
        sampleCount: 0,
        observedFps: 0,
        processingLatencyP95Ms: 0,
        droppedFrameRatio: 1,
        loadPressure: 'unknown',
        latencyDriftRatio: 0,
      };
    }

    const first = samples[0]?.timestampMs ?? nowMs;
    const last = samples.at(-1)?.timestampMs ?? nowMs;
    const elapsedSeconds = Math.max(0.001, (last - first) / 1000);
    const observedFps = samples.length <= 1 ? 0 : (samples.length - 1) / elapsedSeconds;
    const expectedFrames = Math.max(1, elapsedSeconds * this.expectedFps);
    const droppedFrameRatio = clamp01(1 - (Math.max(0, samples.length - 1) / expectedFrames));
    const latencies = samples.map((sample) => sample.processingMs).sort((a, b) => a - b);
    const processingLatencyP95Ms = percentile(latencies, 0.95);

    const midpoint = Math.floor(samples.length / 2);
    const firstHalf = samples.slice(0, midpoint).map((sample) => sample.processingMs).sort((a, b) => a - b);
    const secondHalf = samples.slice(midpoint).map((sample) => sample.processingMs).sort((a, b) => a - b);
    const firstMedian = percentile(firstHalf, 0.5);
    const secondMedian = percentile(secondHalf, 0.5);
    const latencyDriftRatio = firstMedian <= 0 ? 0 : Math.max(0, secondMedian / firstMedian - 1);

    const frameBudgetMs = 1000 / this.expectedFps;
    const loadPressure: NodeLoadPressure = (
      processingLatencyP95Ms > frameBudgetMs * 1.6
      || droppedFrameRatio > 0.3
      || latencyDriftRatio > 0.65
    )
      ? 'critical'
      : (
        processingLatencyP95Ms > frameBudgetMs
        || droppedFrameRatio > 0.12
        || latencyDriftRatio > 0.3
      )
        ? 'elevated'
        : 'nominal';

    return {
      sampleCount: samples.length,
      observedFps,
      processingLatencyP95Ms,
      droppedFrameRatio,
      loadPressure,
      latencyDriftRatio,
    };
  }
}
