import type { EntityType } from '../core/types';
import type { PublicSpatialAggregate } from '../spatial/publicAggregation';
import type { NodeQualityScore } from './quality';

export type CommunityDirection = 'A_TO_B' | 'B_TO_A' | 'UNSPECIFIED';

export interface ObservedSegmentRef {
  /** Stable analysis/public segment identifier, not the sensor/home coordinate. */
  segmentId: string;
  source: 'osm' | 'konta2r' | 'municipal' | 'other';
  sourceVersion?: string;
}

export interface PublicFlowAggregate {
  schemaVersion: '2.0';
  aggregateType: 'flow';
  bucketStartMs: number;
  bucketEndMs: number;
  entityType: EntityType;
  direction: CommunityDirection;
  count: number;
  meanQuality: number;
}

export interface CommunitySpatialAggregate extends PublicSpatialAggregate {
  aggregateType: 'spatial';
}

export type CommunityAggregateRecord = PublicFlowAggregate | CommunitySpatialAggregate;

export function asCommunitySpatialAggregate(
  aggregate: PublicSpatialAggregate,
): CommunitySpatialAggregate {
  return { ...aggregate, aggregateType: 'spatial' };
}

export interface CommunityNodeRuntimeSummary {
  uptimeRatio: number;
  inferenceFpsP50: number;
  inferenceLatencyP95Ms: number;
  droppedFrameRatio?: number;
  runtimeBackend: 'webgpu' | 'wasm' | 'webnn' | 'webgl' | 'unknown';
}

export interface CommunityUploadEnvelope {
  schemaVersion: '2.0';
  /** Pseudonymous technical node id. It must never encode address or user identity. */
  nodeId: string;
  sequence: number;
  generatedAtIso: string;
  observedSegment: ObservedSegmentRef;
  softwareVersion: string;
  methodologyVersion: string;
  modelFingerprint: string;
  quality: NodeQualityScore;
  runtime: CommunityNodeRuntimeSummary;
  records: CommunityAggregateRecord[];
}

const FORBIDDEN_KEY_FRAGMENTS = [
  'trackid',
  'rendertrackid',
  'face',
  'plate',
  'licenseplate',
  'embedding',
  'biometric',
  'image',
  'video',
  'latitude',
  'longitude',
  'address',
  'home',
  'domicile',
] as const;

export interface CommunityProtocolValidation {
  valid: boolean;
  errors: string[];
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function scanForbiddenKeys(value: unknown, path = '$'): string[] {
  if (value === null || typeof value !== 'object') return [];
  const errors: string[] = [];

  if (Array.isArray(value)) {
    value.forEach((item, index) => errors.push(...scanForbiddenKeys(item, `${path}[${index}]`)));
    return errors;
  }

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.toLowerCase().replaceAll('_', '').replaceAll('-', '');
    if (FORBIDDEN_KEY_FRAGMENTS.some((fragment) => normalized.includes(fragment))) {
      errors.push(`forbidden_privacy_field:${path}.${key}`);
    }
    errors.push(...scanForbiddenKeys(child, `${path}.${key}`));
  }
  return errors;
}

export function validateCommunityUpload(
  envelope: CommunityUploadEnvelope,
): CommunityProtocolValidation {
  const errors = scanForbiddenKeys(envelope);

  if (!/^node_[a-zA-Z0-9_-]{6,80}$/.test(envelope.nodeId)) {
    errors.push('invalid_pseudonymous_node_id');
  }
  if (envelope.sequence < 0 || !Number.isInteger(envelope.sequence)) {
    errors.push('invalid_sequence');
  }
  if (Number.isNaN(Date.parse(envelope.generatedAtIso))) {
    errors.push('invalid_generated_at');
  }
  if (envelope.observedSegment.segmentId.trim().length === 0) {
    errors.push('observed_segment_required');
  }
  if (envelope.records.length === 0) {
    errors.push('at_least_one_aggregate_required');
  }
  if (envelope.records.length > 10_000) {
    errors.push('aggregate_batch_too_large');
  }

  if (envelope.runtime.uptimeRatio !== clamp01(envelope.runtime.uptimeRatio)) {
    errors.push('invalid_uptime_ratio');
  }
  if (envelope.runtime.inferenceFpsP50 < 0 || !Number.isFinite(envelope.runtime.inferenceFpsP50)) {
    errors.push('invalid_inference_fps');
  }
  if (
    envelope.runtime.inferenceLatencyP95Ms < 0
    || !Number.isFinite(envelope.runtime.inferenceLatencyP95Ms)
  ) {
    errors.push('invalid_inference_latency');
  }
  if (
    envelope.runtime.droppedFrameRatio !== undefined
    && envelope.runtime.droppedFrameRatio !== clamp01(envelope.runtime.droppedFrameRatio)
  ) {
    errors.push('invalid_dropped_frame_ratio');
  }
  if (envelope.quality.overall !== clamp01(envelope.quality.overall)) {
    errors.push('invalid_node_quality');
  }

  for (const [index, record] of envelope.records.entries()) {
    if (!(record.bucketEndMs > record.bucketStartMs)) {
      errors.push(`invalid_bucket:${index}`);
    }
    // Community payloads should not transport quasi-event timestamps.
    if (record.bucketEndMs - record.bucketStartMs < 60_000) {
      errors.push(`bucket_too_fine_for_community_upload:${index}`);
    }
    if (record.aggregateType === 'flow') {
      if (!Number.isInteger(record.count) || record.count < 0) {
        errors.push(`invalid_flow_count:${index}`);
      }
      if (record.meanQuality !== clamp01(record.meanQuality)) {
        errors.push(`invalid_mean_quality:${index}`);
      }
    } else {
      if (!Number.isInteger(record.uniqueEntities) || record.uniqueEntities < 0) {
        errors.push(`invalid_unique_entities:${index}`);
      }
      if (!(record.cellSizeMeters >= 2)) {
        errors.push(`public_cell_too_fine:${index}`);
      }
      if (record.meanQuality !== clamp01(record.meanQuality)) {
        errors.push(`invalid_mean_quality:${index}`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

export function assertCommunityUploadSafe(envelope: CommunityUploadEnvelope): void {
  const validation = validateCommunityUpload(envelope);
  if (!validation.valid) {
    throw new Error(`Unsafe/invalid community upload: ${validation.errors.join(', ')}`);
  }
}
