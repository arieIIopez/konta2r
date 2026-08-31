import { describe, expect, it } from 'vitest';
import { NodeHealthMonitor } from '../../src/node/healthMonitor';

function feed(
  monitor: NodeHealthMonitor,
  startMs: number,
  count: number,
  intervalMs: number,
  processingMs: (index: number) => number,
): number {
  for (let index = 0; index < count; index += 1) {
    monitor.record({
      timestampMs: startMs + index * intervalMs,
      processingMs: processingMs(index),
    });
  }
  return startMs + (count - 1) * intervalMs;
}

describe('node health monitor', () => {
  it('reports nominal load when cadence and latency are healthy', () => {
    const monitor = new NodeHealthMonitor({ expectedFps: 5, windowMs: 60_000 });
    const now = feed(monitor, 0, 51, 200, () => 55);
    const snapshot = monitor.snapshot(now);

    expect(snapshot.observedFps).toBeCloseTo(5, 1);
    expect(snapshot.droppedFrameRatio).toBeLessThan(0.03);
    expect(snapshot.loadPressure).toBe('nominal');
  });

  it('reports elevated or critical pressure under sustained frame loss', () => {
    const monitor = new NodeHealthMonitor({ expectedFps: 10, windowMs: 60_000 });
    const now = feed(monitor, 0, 21, 250, () => 130);
    const snapshot = monitor.snapshot(now);

    expect(snapshot.observedFps).toBeCloseTo(4, 1);
    expect(snapshot.droppedFrameRatio).toBeGreaterThan(0.5);
    expect(snapshot.loadPressure).toBe('critical');
  });

  it('detects latency drift without claiming physical temperature', () => {
    const monitor = new NodeHealthMonitor({ expectedFps: 5, windowMs: 60_000 });
    const now = feed(monitor, 0, 40, 200, (index) => index < 20 ? 45 : 80);
    const snapshot = monitor.snapshot(now);

    expect(snapshot.latencyDriftRatio).toBeGreaterThan(0.7);
    expect(snapshot.loadPressure).toBe('critical');
  });
});
