import { describe, expect, it } from 'vitest';
import {
  assessCorrespondenceCoverage,
  evaluateCalibrationAssistant,
} from '../../src/spatial/calibrationAssistant';
import type { CalibrationCorrespondence } from '../../src/spatial/calibration';

function point(ix: number, iy: number, gx: number, gy: number): CalibrationCorrespondence {
  return {
    imagePoint: { x: ix, y: iy },
    groundPoint: { x: gx, y: gy },
  };
}

const wellDistributed: CalibrationCorrespondence[] = [
  point(100, 100, 0, 0),
  point(1100, 120, 100, 0),
  point(1080, 620, 100, 50),
  point(120, 600, 0, 50),
  point(640, 140, 50, 4),
  point(650, 580, 50, 46),
];

describe('calibration assistant', () => {
  it('requires at least four correspondences', () => {
    const report = evaluateCalibrationAssistant({
      imageWidth: 1280,
      imageHeight: 720,
      correspondences: wellDistributed.slice(0, 3),
      fitOptions: { groundUnitsPerMeter: 10 },
    });

    expect(report.status).toBe('needs_more_points');
    expect(report.combinedQuality).toBe(0);
  });

  it('detects points concentrated in one image region', () => {
    const clustered = [
      point(100, 100, 0, 0),
      point(180, 100, 8, 0),
      point(180, 180, 8, 8),
      point(100, 180, 0, 8),
      point(140, 140, 4, 4),
    ];

    const coverage = assessCorrespondenceCoverage(clustered, 1280, 720);
    const report = evaluateCalibrationAssistant({
      imageWidth: 1280,
      imageHeight: 720,
      correspondences: clustered,
      fitOptions: { groundUnitsPerMeter: 1 },
    });

    expect(coverage.score).toBeLessThan(0.42);
    expect(report.status).toBe('needs_better_distribution');
  });

  it('accepts a well distributed, internally consistent calibration', () => {
    const report = evaluateCalibrationAssistant({
      imageWidth: 1280,
      imageHeight: 720,
      correspondences: wellDistributed,
      fitOptions: {
        groundUnitsPerMeter: 1,
        inlierThresholdMeters: 1,
      },
    });

    expect(report.coverage.score).toBeGreaterThan(0.6);
    expect(report.status).toBe('calibrated');
    expect(report.fit?.status).toBe('valid');
    expect(report.combinedQuality).toBeGreaterThan(0.6);
  });

  it('survives a single badly placed control point through robust fitting', () => {
    const withOutlier = [
      ...wellDistributed,
      point(620, 350, 500, -300),
    ];

    const report = evaluateCalibrationAssistant({
      imageWidth: 1280,
      imageHeight: 720,
      correspondences: withOutlier,
      fitOptions: {
        groundUnitsPerMeter: 1,
        inlierThresholdMeters: 1,
      },
    });

    expect(report.fit?.inlierRatio).toBeGreaterThanOrEqual(6 / 7);
    expect(report.fit?.inlierRatio).toBeLessThan(1);
  });
});
