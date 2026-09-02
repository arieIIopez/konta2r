import type { DetectorInitialization } from '../detection/types';
import type { NodeRuntimeSnapshot } from '../node/runtimeController';
import type { ClosedCommunityFlowBucket } from './flowBucketCollector';
import type { CommunityNodeRuntimeSummary } from './protocol';
import { computeNodeQuality, type NodeQualityScore } from './quality';

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function meanPublishedConfidence(bucket: ClosedCommunityFlowBucket): number {
  let weighted = 0;
  let count = 0;
  for (const record of bucket.records) {
    weighted += record.meanQuality * record.count;
    count += record.count;
  }
  return count > 0 ? clamp01(weighted / count) : 0;
}

function deviceQuality(snapshot: NodeRuntimeSnapshot): number {
  const frameDelivery = clamp01(1 - snapshot.health.droppedFrameRatio);
  const pressureFactor = snapshot.health.loadPressure === 'nominal'
    ? 1
    : snapshot.health.loadPressure === 'elevated'
      ? 0.75
      : snapshot.health.loadPressure === 'critical'
        ? 0.4
        : 0.6;
  return clamp01(frameDelivery * pressureFactor);
}

/**
 * Converts only measured node telemetry into the public Community runtime
 * summary. It does not infer temperature, battery health or hardware metrics
 * that the browser has not actually measured.
 */
export function communityRuntimeSummary(
  snapshot: NodeRuntimeSnapshot,
  detector: DetectorInitialization,
): CommunityNodeRuntimeSummary {
  return {
    uptimeRatio: clamp01(snapshot.continuity.uptimeRatio),
    inferenceFpsP50: Math.max(0, snapshot.health.observedFps),
    inferenceLatencyP95Ms: Math.max(0, snapshot.health.processingLatencyP95Ms),
    droppedFrameRatio: clamp01(snapshot.health.droppedFrameRatio),
    runtimeBackend: detector.runtime.backend,
  };
}

/**
 * The crossing confidence emitted by TrackCountingEngine is the minimum of the
 * sample confidence and track quality. Until detector/tracker validation is
 * calibrated independently, the same conservative lower-bound proxy feeds both
 * dimensions and is explicitly labelled as such in the evidence field.
 */
export function communityQualityFromFlowBucket(
  bucket: ClosedCommunityFlowBucket,
  snapshot: NodeRuntimeSnapshot,
): NodeQualityScore {
  const crossingConfidence = meanPublishedConfidence(bucket);
  const quality = computeNodeQuality({
    detection: crossingConfidence,
    tracking: crossingConfidence,
    temporal: clamp01(snapshot.continuity.uptimeRatio),
    device: deviceQuality(snapshot),
  });
  quality.dimensions.detection.evidence = 'conservative_crossing_confidence_proxy';
  quality.dimensions.tracking.evidence = 'conservative_crossing_confidence_proxy';
  quality.dimensions.temporal.evidence = 'node_observation_uptime_ratio';
  quality.dimensions.device.evidence = 'frame_delivery_and_runtime_load_pressure';
  return quality;
}

export function communityModelFingerprint(detector: DetectorInitialization): string {
  const sha = detector.model.modelSha256?.trim();
  if (sha) return sha.toLowerCase().startsWith('sha256:') ? sha : `sha256:${sha}`;
  return [
    detector.model.adapterId,
    detector.model.modelId,
    detector.model.modelVersion,
  ].join('@');
}
