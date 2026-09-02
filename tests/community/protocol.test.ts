import { describe, expect, it } from 'vitest';
import {
  assertCommunityUploadSafe,
  validateCommunityUpload,
  type CommunityUploadEnvelope,
} from '../../src/community/protocol';
import { computeNodeQuality } from '../../src/community/quality';

function validEnvelope(): CommunityUploadEnvelope {
  return {
    schemaVersion: '2.0',
    nodeId: 'node_abc12345',
    sequence: 42,
    generatedAtIso: '2026-08-30T23:00:00.000Z',
    observedSegment: {
      segmentId: 'osm_way_123:segment_4',
      source: 'osm',
      sourceVersion: '2026-08',
    },
    softwareVersion: '2.0.0-alpha.1',
    methodologyVersion: '2.0',
    modelFingerprint: 'sha256:example',
    quality: computeNodeQuality({
      detection: 0.9,
      tracking: 0.88,
      temporal: 0.95,
      device: 0.9,
      validation: 0.86,
    }),
    runtime: {
      uptimeRatio: 0.98,
      inferenceFpsP50: 5.1,
      inferenceLatencyP95Ms: 180,
      droppedFrameRatio: 0.04,
      runtimeBackend: 'wasm',
    },
    records: [{
      schemaVersion: '2.0',
      aggregateType: 'flow',
      bucketStartMs: 1_788_000_000_000,
      bucketEndMs: 1_788_000_300_000,
      entityType: 'cyclist',
      direction: 'A_TO_B',
      count: 12,
      meanQuality: 0.87,
    }],
  };
}

describe('community upload protocol', () => {
  it('accepts an aggregate-only pseudonymous payload', () => {
    const envelope = validEnvelope();
    expect(validateCommunityUpload(envelope)).toEqual({ valid: true, errors: [] });
    expect(() => assertCommunityUploadSafe(envelope)).not.toThrow();
  });

  it('rejects event-like time buckets that are too fine', () => {
    const envelope = validEnvelope();
    envelope.records[0] = {
      ...envelope.records[0]!,
      bucketEndMs: envelope.records[0]!.bucketStartMs + 30_000,
    };

    const validation = validateCommunityUpload(envelope);
    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain('bucket_too_fine_for_community_upload:0');
  });

  it('detects a forbidden track identifier even if accidentally added to a record', () => {
    const unsafe = validEnvelope() as CommunityUploadEnvelope & {
      leakedTrackId?: string;
    };
    unsafe.leakedTrackId = 't_9182';

    const validation = validateCommunityUpload(unsafe);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((error) => error.includes('forbidden_privacy_field'))).toBe(true);
  });

  it('detects accidental residential coordinates', () => {
    const unsafe = validEnvelope() as CommunityUploadEnvelope & {
      privateLocation?: { latitude: number; longitude: number };
    };
    unsafe.privateLocation = { latitude: -33.4, longitude: -70.6 };

    const validation = validateCommunityUpload(unsafe);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((error) => error.includes('latitude'))).toBe(true);
    expect(validation.errors.some((error) => error.includes('longitude'))).toBe(true);
  });

  it('rejects spatial cells finer than the public privacy floor', () => {
    const envelope = validEnvelope();
    envelope.records = [{
      schemaVersion: '2.0',
      aggregateType: 'spatial',
      bucketStartMs: 1_788_000_000_000,
      bucketEndMs: 1_788_000_300_000,
      cellX: 2,
      cellY: 4,
      cellSizeMeters: 1,
      entityType: 'pedestrian',
      uniqueEntities: 8,
      sampleCount: 23,
      meanQuality: 0.82,
    }];

    const validation = validateCommunityUpload(envelope);
    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain('public_cell_too_fine:0');
  });

  it('rejects node IDs that look like arbitrary/raw identifiers', () => {
    const envelope = validEnvelope();
    envelope.nodeId = 'home@123';
    expect(validateCommunityUpload(envelope).errors).toContain('invalid_pseudonymous_node_id');
  });
});
