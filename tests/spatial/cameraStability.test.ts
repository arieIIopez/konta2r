import { describe, expect, it } from 'vitest';
import {
  assessCameraStability,
  type StaticAnchorObservation,
} from '../../src/spatial/cameraStability';

function gridAnchors(
  transform: (x: number, y: number) => { x: number; y: number },
): StaticAnchorObservation[] {
  const anchors: StaticAnchorObservation[] = [];
  for (let y = 100; y <= 500; y += 100) {
    for (let x = 100; x <= 900; x += 200) {
      anchors.push({
        reference: { x, y },
        current: transform(x, y),
        confidence: 0.95,
      });
    }
  }
  return anchors;
}

describe('camera stability guard', () => {
  it('accepts sub-pixel/small tracking jitter', () => {
    const anchors = gridAnchors((x, y) => ({ x: x + 0.8, y: y - 0.6 }));
    const report = assessCameraStability(anchors);

    expect(report.status).toBe('stable');
    expect(report.medianDisplacementPx).toBeLessThan(3);
  });

  it('marks calibration stale after a physical camera translation', () => {
    const anchors = gridAnchors((x, y) => ({ x: x + 12, y: y + 7 }));
    const report = assessCameraStability(anchors);

    expect(report.status).toBe('moved');
    expect(report.reasons).toContain('median_anchor_displacement_exceeded');
  });

  it('detects digital zoom or lens changes through pairwise scale drift', () => {
    const center = { x: 500, y: 300 };
    const anchors = gridAnchors((x, y) => ({
      x: center.x + (x - center.x) * 1.04,
      y: center.y + (y - center.y) * 1.04,
    }));
    const report = assessCameraStability(anchors);

    expect(report.status).toBe('moved');
    expect(report.scaleDriftRatio).toBeGreaterThan(0.03);
    expect(report.reasons).toContain('camera_scale_or_zoom_changed');
  });

  it('returns uncertain instead of assuming stability with too few anchors', () => {
    const anchors = gridAnchors((x, y) => ({ x, y })).slice(0, 4);
    const report = assessCameraStability(anchors);

    expect(report.status).toBe('uncertain');
    expect(report.reasons).toContain('insufficient_static_anchors');
  });
});
