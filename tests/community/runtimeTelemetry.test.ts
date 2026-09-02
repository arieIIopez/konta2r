import { describe, expect, it } from 'vitest';
import type { DetectorInitialization } from '../../src/detection/types';
import type { NodeRuntimeSnapshot } from '../../src/node/runtimeController';
import type { ClosedCommunityFlowBucket } from '../../src/community/flowBucketCollector';
import {
  communityModelFingerprint,
  communityQualityFromFlowBucket,
  communityRuntimeSummary,
} from '../../src/community/runtimeTelemetry';

function detector(): DetectorInitialization {
  return {
    model: {
      adapterId: 'ssd-tf-object-detection',
      modelId: 'mobilenet-v2-coco',
      modelVersion: '2026-07',
      modelSha256: 'abc123',
      weightsRedistributionVerified: true,
      inputWidth: 320,
      inputHeight: 320,
      classNames: ['person', 'car'],
    },
    runtime: {
      runtime: 'onnxruntime-web',
      runtimeVersion: '1.29.0',
      backend: 'wasm',
      executionProviders: ['wasm'],
    },
  };
}

function runtimeSnapshot(): NodeRuntimeSnapshot {
  return {
    running: true,
    busy: false,
    profile: 'balanced',
    hints: {},
    camera: { active: true },
    wakeLock: { supported: true, active: true },
    storage: null,
    health: {
      sampleCount: 100,
      observedFps: 4.8,
      inferenceFpsP50: 4.7,
      processingLatencyP95Ms: 190,
      droppedFrameRatio: 0.08,
      loadPressure: 'nominal',
      latencyDriftRatio: 0.04,
    },
    continuity: {
      state: 'active',
      elapsedMs: 300_000,
      activeMs: 285_000,
      uptimeRatio: 0.95,
      gapCount: 1,
      longestGapMs: 15_000,
    },
    online: true,
    secureContext: true,
  } as NodeRuntimeSnapshot;
}

function bucket(): ClosedCommunityFlowBucket {
  return {
    streamId: 'line_main',
    bucketStartMs: 1_788_000_000_000,
    bucketEndMs: 1_788_000_300_000,
    suppressedCount: 0,
    records: [{
      schemaVersion: '2.0',
      aggregateType: 'flow',
      bucketStartMs: 1_788_000_000_000,
      bucketEndMs: 1_788_000_300_000,
      entityType: 'cyclist',
      direction: 'A_TO_B',
      count: 10,
      meanQuality: 0.82,
    }],
  };
}

describe('Community runtime telemetry', () => {
  it('maps measured node runtime values without fabricating hardware telemetry', () => {
    const summary = communityRuntimeSummary(runtimeSnapshot(), detector());
    expect(summary).toEqual({
      uptimeRatio: 0.95,
      inferenceFpsP50: 4.7,
      inferenceLatencyP95Ms: 190,
      droppedFrameRatio: 0.08,
      runtimeBackend: 'wasm',
    });
  });

  it('keeps quality provisional and labels the crossing-confidence proxy', () => {
    const quality = communityQualityFromFlowBucket(bucket(), runtimeSnapshot());
    expect(quality.status).toBe('provisional');
    expect(quality.dimensions.detection.value).toBeCloseTo(0.82);
    expect(quality.dimensions.tracking.value).toBeCloseTo(0.82);
    expect(quality.dimensions.detection.evidence).toBe('conservative_crossing_confidence_proxy');
    expect(quality.warnings).toContain('ground_truth_validation_missing');
  });

  it('uses the detector SHA when available and falls back to versioned model identity', () => {
    expect(communityModelFingerprint(detector())).toBe('sha256:abc123');
    const withoutSha = detector();
    delete withoutSha.model.modelSha256;
    expect(communityModelFingerprint(withoutSha)).toBe(
      'ssd-tf-object-detection@mobilenet-v2-coco@2026-07',
    );
  });
});
