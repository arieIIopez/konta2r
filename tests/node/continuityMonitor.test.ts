import { describe, expect, it } from 'vitest';
import { ObservationContinuityMonitor } from '../../src/node/continuityMonitor';

describe('observation continuity monitor', () => {
  it('measures active coverage separately from elapsed installation time', () => {
    const monitor = new ObservationContinuityMonitor();
    monitor.start(0);
    monitor.pause('visibility_hidden', 10_000);
    monitor.resume(20_000);
    monitor.stop(30_000);

    const snapshot = monitor.snapshot(40_000);
    expect(snapshot.elapsedMs).toBe(30_000);
    expect(snapshot.activeMs).toBe(20_000);
    expect(snapshot.uptimeRatio).toBeCloseTo(2 / 3, 5);
    expect(snapshot.gapCount).toBe(1);
    expect(snapshot.longestGapMs).toBe(10_000);
  });

  it('keeps an open pause measurable until observation resumes', () => {
    const monitor = new ObservationContinuityMonitor();
    monitor.start(1000);
    monitor.pause('camera_ended', 6000);

    const snapshot = monitor.snapshot(16_000);
    expect(snapshot.state).toBe('paused');
    expect(snapshot.currentGapReason).toBe('camera_ended');
    expect(snapshot.longestGapMs).toBe(10_000);
    expect(snapshot.activeMs).toBe(5000);
  });

  it('rejects non-monotonic timestamps', () => {
    const monitor = new ObservationContinuityMonitor();
    monitor.start(5000);
    expect(() => monitor.pause('unknown', 4000)).toThrow(/monotonic/i);
  });
});
