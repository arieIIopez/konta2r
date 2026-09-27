import { computeNodeCredentialHmac, isValidNodeCredential, isValidNodeId } from './nodeCredential';
import { IncrementalSha256 } from '../core/sha256';
import type { EntityType } from '../core/types';
import {
  validateCommunityUpload,
  type CommunityAggregateRecord,
  type CommunityDirection,
  type CommunityNodeRuntimeSummary,
  type CommunityUploadEnvelope,
  type ObservedSegmentRef,
} from '../community/protocol';
import type {
  NodeQualityDimension,
  NodeQualityDimensionName,
  NodeQualityScore,
} from '../community/quality';

const MAX_COMMUNITY_BODY_BYTES = 4 * 1024 * 1024;
const MAX_FUTURE_CLOCK_SKEW_MS = 10 * 60 * 1000;

const ENTITY_TYPES: readonly EntityType[] = [
  'pedestrian', 'cyclist', 'skater', 'motorcyclist', 'car', 'bus', 'truck', 'pet', 'unknown',
];
const DIRECTIONS: readonly CommunityDirection[] = ['A_TO_B', 'B_TO_A', 'UNSPECIFIED'];
const SEGMENT_SOURCES: readonly ObservedSegmentRef['source'][] = ['osm', 'konta2r', 'municipal', 'other'];
const RUNTIME_BACKENDS: readonly CommunityNodeRuntimeSummary['runtimeBackend'][] = [
  'webgpu', 'wasm', 'webnn', 'webgl', 'unknown',
];
const QUALITY_DIMENSIONS: readonly NodeQualityDimensionName[] = [
  'detection', 'tracking', 'geometry', 'temporal', 'device', 'validation', 'consistency',
];

export type IngestionFailureCode =
  | 'method_not_allowed'
  | 'invalid_content_type'
  | 'payload_too_large'
  | 'invalid_json'
  | 'invalid_payload_shape'
  | 'unsafe_payload'
  | 'invalid_authorization'
  | 'idempotency_mismatch'
  | 'segment_mismatch'
  | 'future_generated_at'
  | 'idempotency_conflict';

export interface CommunityIngestionRequest {
  method: string;
  headers: Headers | Readonly<Record<string, string | undefined>>;
  bodyText: string;
}

export interface AuthorizedNode {
  nodeId: string;
  segmentId: string;
}

export type NodeAuthorizationResult =
  | { authorized: true; node: AuthorizedNode }
  | { authorized: false };

export type NodeCredentialVerifier = (
  nodeId: string,
  credential: string,
) => Promise<NodeAuthorizationResult>;

export interface PersistedCommunityBatchIdentity {
  nodeId: string;
  sequence: number;
  payloadSha256: string;
}

export interface PreparedCommunityBatch extends PersistedCommunityBatchIdentity {
  envelope: CommunityUploadEnvelope;
}

export type CommunityPersistenceResult =
  | { status: 'inserted'; batchId: string }
  | { status: 'duplicate_same_payload'; batchId: string }
  | { status: 'conflict'; existingPayloadSha256: string };

/**
 * Must enforce (nodeId, sequence) uniqueness atomically. The production adapter
 * will implement this inside PostgreSQL rather than relying on a race-prone
 * read-before-insert check in the Edge Function.
 */
export interface CommunityIngestionStore {
  persist(batch: PreparedCommunityBatch): Promise<CommunityPersistenceResult>;
}

export type CommunityIngestionResult =
  | {
      ok: true;
      statusCode: 200 | 201;
      disposition: 'inserted' | 'duplicate';
      batchId: string;
      payloadSha256: string;
    }
  | {
      ok: false;
      statusCode: 400 | 401 | 403 | 405 | 409 | 413 | 415 | 422;
      code: IngestionFailureCode;
      detail?: string;
    };

function headerValue(
  headers: CommunityIngestionRequest['headers'],
  name: string,
): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  const needle = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === needle) return value;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return required.every((key) => Object.hasOwn(value, key))
    && keys.every((key) => allowed.includes(key));
}

function stringValue(value: unknown, maxLength = 512): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    ? value
    : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && allowed.includes(value as T) ? value as T : undefined;
}

function parseStringArray(value: unknown, maxItems: number, maxLength: number): string[] | undefined {
  if (!Array.isArray(value) || value.length > maxItems) return undefined;
  const parsed: string[] = [];
  for (const item of value) {
    const text = stringValue(item, maxLength);
    if (text === undefined) return undefined;
    parsed.push(text);
  }
  return parsed;
}

function parseQualityDimension(value: unknown): NodeQualityDimension | undefined {
  if (!isRecord(value) || !exactKeys(
    value,
    ['value', 'weight', 'applicable', 'evidence'],
    ['value', 'weight', 'applicable'],
  )) return undefined;
  const dimensionValue = finiteNumber(value.value);
  const weight = finiteNumber(value.weight);
  const applicable = booleanValue(value.applicable);
  if (
    dimensionValue === undefined || dimensionValue < 0 || dimensionValue > 1
    || weight === undefined || weight < 0 || weight > 1
    || applicable === undefined
  ) return undefined;
  const evidence = value.evidence === undefined ? undefined : stringValue(value.evidence, 1000);
  if (value.evidence !== undefined && evidence === undefined) return undefined;
  return {
    value: dimensionValue,
    weight,
    applicable,
    ...(evidence === undefined ? {} : { evidence }),
  };
}

function parseNodeQuality(value: unknown): NodeQualityScore | undefined {
  if (!isRecord(value) || !exactKeys(
    value,
    ['methodVersion', 'overall', 'status', 'dimensions', 'warnings'],
    ['methodVersion', 'overall', 'status', 'dimensions', 'warnings'],
  )) return undefined;
  if (value.methodVersion !== '0.1') return undefined;
  const overall = finiteNumber(value.overall);
  const status = oneOf(value.status, ['provisional', 'validated'] as const);
  const warnings = parseStringArray(value.warnings, 100, 256);
  if (overall === undefined || overall < 0 || overall > 1 || status === undefined || warnings === undefined) {
    return undefined;
  }
  if (!isRecord(value.dimensions) || !exactKeys(value.dimensions, QUALITY_DIMENSIONS, QUALITY_DIMENSIONS)) {
    return undefined;
  }
  const dimensions = {} as Record<NodeQualityDimensionName, NodeQualityDimension>;
  for (const name of QUALITY_DIMENSIONS) {
    const dimension = parseQualityDimension(value.dimensions[name]);
    if (dimension === undefined) return undefined;
    dimensions[name] = dimension;
  }
  return { methodVersion: '0.1', overall, status, dimensions, warnings };
}

function parseRuntime(value: unknown): CommunityNodeRuntimeSummary | undefined {
  if (!isRecord(value) || !exactKeys(
    value,
    ['uptimeRatio', 'inferenceFpsP50', 'inferenceLatencyP95Ms', 'droppedFrameRatio', 'runtimeBackend'],
    ['uptimeRatio', 'inferenceFpsP50', 'inferenceLatencyP95Ms', 'runtimeBackend'],
  )) return undefined;
  const uptimeRatio = finiteNumber(value.uptimeRatio);
  const inferenceFpsP50 = finiteNumber(value.inferenceFpsP50);
  const inferenceLatencyP95Ms = finiteNumber(value.inferenceLatencyP95Ms);
  const runtimeBackend = oneOf(value.runtimeBackend, RUNTIME_BACKENDS);
  const droppedFrameRatio = value.droppedFrameRatio === undefined
    ? undefined
    : finiteNumber(value.droppedFrameRatio);
  if (
    uptimeRatio === undefined || uptimeRatio < 0 || uptimeRatio > 1
    || inferenceFpsP50 === undefined || inferenceFpsP50 < 0
    || inferenceLatencyP95Ms === undefined || inferenceLatencyP95Ms < 0
    || runtimeBackend === undefined
    || (droppedFrameRatio !== undefined && (droppedFrameRatio < 0 || droppedFrameRatio > 1))
    || (value.droppedFrameRatio !== undefined && droppedFrameRatio === undefined)
  ) return undefined;
  return {
    uptimeRatio,
    inferenceFpsP50,
    inferenceLatencyP95Ms,
    runtimeBackend,
    ...(droppedFrameRatio === undefined ? {} : { droppedFrameRatio }),
  };
}

function parseObservedSegment(value: unknown): ObservedSegmentRef | undefined {
  if (!isRecord(value) || !exactKeys(
    value,
    ['segmentId', 'source', 'sourceVersion'],
    ['segmentId', 'source'],
  )) return undefined;
  const segmentId = stringValue(value.segmentId, 160);
  const source = oneOf(value.source, SEGMENT_SOURCES);
  const sourceVersion = value.sourceVersion === undefined ? undefined : stringValue(value.sourceVersion, 160);
  if (segmentId === undefined || source === undefined) return undefined;
  if (value.sourceVersion !== undefined && sourceVersion === undefined) return undefined;
  return { segmentId, source, ...(sourceVersion === undefined ? {} : { sourceVersion }) };
}

function parseFlowRecord(value: Record<string, unknown>): CommunityAggregateRecord | undefined {
  if (!exactKeys(
    value,
    ['schemaVersion', 'aggregateType', 'bucketStartMs', 'bucketEndMs', 'entityType', 'direction', 'count', 'meanQuality'],
    ['schemaVersion', 'aggregateType', 'bucketStartMs', 'bucketEndMs', 'entityType', 'direction', 'count', 'meanQuality'],
  )) return undefined;
  if (value.schemaVersion !== '2.0' || value.aggregateType !== 'flow') return undefined;
  const bucketStartMs = nonNegativeInteger(value.bucketStartMs);
  const bucketEndMs = nonNegativeInteger(value.bucketEndMs);
  const entityType = oneOf(value.entityType, ENTITY_TYPES);
  const direction = oneOf(value.direction, DIRECTIONS);
  const count = nonNegativeInteger(value.count);
  const meanQuality = finiteNumber(value.meanQuality);
  if (
    bucketStartMs === undefined || bucketEndMs === undefined || entityType === undefined
    || direction === undefined || count === undefined || meanQuality === undefined
  ) return undefined;
  return {
    schemaVersion: '2.0', aggregateType: 'flow', bucketStartMs, bucketEndMs,
    entityType, direction, count, meanQuality,
  };
}

function parseSpatialRecord(value: Record<string, unknown>): CommunityAggregateRecord | undefined {
  if (!exactKeys(
    value,
    [
      'schemaVersion', 'aggregateType', 'bucketStartMs', 'bucketEndMs', 'cellX', 'cellY',
      'cellSizeMeters', 'entityType', 'uniqueEntities', 'sampleCount', 'meanSpeedMps', 'meanQuality',
    ],
    [
      'schemaVersion', 'aggregateType', 'bucketStartMs', 'bucketEndMs', 'cellX', 'cellY',
      'cellSizeMeters', 'entityType', 'uniqueEntities', 'sampleCount', 'meanQuality',
    ],
  )) return undefined;
  if (value.schemaVersion !== '2.0' || value.aggregateType !== 'spatial') return undefined;
  const bucketStartMs = nonNegativeInteger(value.bucketStartMs);
  const bucketEndMs = nonNegativeInteger(value.bucketEndMs);
  const cellX = finiteNumber(value.cellX);
  const cellY = finiteNumber(value.cellY);
  const cellSizeMeters = finiteNumber(value.cellSizeMeters);
  const entityType = oneOf(value.entityType, ENTITY_TYPES);
  const uniqueEntities = nonNegativeInteger(value.uniqueEntities);
  const sampleCount = nonNegativeInteger(value.sampleCount);
  const meanQuality = finiteNumber(value.meanQuality);
  const meanSpeedMps = value.meanSpeedMps === undefined ? undefined : finiteNumber(value.meanSpeedMps);
  if (
    bucketStartMs === undefined || bucketEndMs === undefined || cellX === undefined || !Number.isInteger(cellX)
    || cellY === undefined || !Number.isInteger(cellY) || cellSizeMeters === undefined
    || entityType === undefined || uniqueEntities === undefined || sampleCount === undefined
    || meanQuality === undefined || (value.meanSpeedMps !== undefined && meanSpeedMps === undefined)
  ) return undefined;
  return {
    schemaVersion: '2.0', aggregateType: 'spatial', bucketStartMs, bucketEndMs,
    cellX, cellY, cellSizeMeters, entityType, uniqueEntities, sampleCount,
    ...(meanSpeedMps === undefined ? {} : { meanSpeedMps }),
    meanQuality,
  };
}

function parseRecords(value: unknown): CommunityAggregateRecord[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > 10_000) return undefined;
  const records: CommunityAggregateRecord[] = [];
  for (const item of value) {
    if (!isRecord(item)) return undefined;
    const parsed = item.aggregateType === 'flow'
      ? parseFlowRecord(item)
      : item.aggregateType === 'spatial'
        ? parseSpatialRecord(item)
        : undefined;
    if (parsed === undefined) return undefined;
    records.push(parsed);
  }
  return records;
}

export function parseCommunityUploadJson(bodyText: string): CommunityUploadEnvelope {
  let raw: unknown;
  try {
    raw = JSON.parse(bodyText) as unknown;
  } catch {
    throw new Error('invalid_json');
  }
  if (!isRecord(raw) || !exactKeys(
    raw,
    [
      'schemaVersion', 'nodeId', 'sequence', 'generatedAtIso', 'observedSegment',
      'softwareVersion', 'methodologyVersion', 'modelFingerprint', 'quality', 'runtime', 'records',
    ],
    [
      'schemaVersion', 'nodeId', 'sequence', 'generatedAtIso', 'observedSegment',
      'softwareVersion', 'methodologyVersion', 'modelFingerprint', 'quality', 'runtime', 'records',
    ],
  )) throw new Error('invalid_payload_shape');
  if (raw.schemaVersion !== '2.0') throw new Error('invalid_payload_shape');
  const nodeId = stringValue(raw.nodeId, 96);
  const sequence = nonNegativeInteger(raw.sequence);
  const generatedAtIso = stringValue(raw.generatedAtIso, 64);
  const observedSegment = parseObservedSegment(raw.observedSegment);
  const softwareVersion = stringValue(raw.softwareVersion, 160);
  const methodologyVersion = stringValue(raw.methodologyVersion, 160);
  const modelFingerprint = stringValue(raw.modelFingerprint, 512);
  const quality = parseNodeQuality(raw.quality);
  const runtime = parseRuntime(raw.runtime);
  const records = parseRecords(raw.records);
  if (
    nodeId === undefined || !isValidNodeId(nodeId) || sequence === undefined || generatedAtIso === undefined
    || observedSegment === undefined || softwareVersion === undefined || methodologyVersion === undefined
    || modelFingerprint === undefined || quality === undefined || runtime === undefined || records === undefined
  ) throw new Error('invalid_payload_shape');
  const envelope: CommunityUploadEnvelope = {
    schemaVersion: '2.0', nodeId, sequence, generatedAtIso, observedSegment,
    softwareVersion, methodologyVersion, modelFingerprint, quality, runtime, records,
  };
  const semantic = validateCommunityUpload(envelope);
  if (!semantic.valid) throw new Error(`unsafe_payload:${semantic.errors.join(',')}`);
  return envelope;
}

export function communityPayloadSha256(bodyText: string): string {
  return new IncrementalSha256().update(new TextEncoder().encode(bodyText)).digestHex();
}

export interface NodeCredentialRow {
  nodeId: string;
  segmentId: string;
  credentialHmac: string;
  keyVersion: number;
  nodeStatus: 'provisioning' | 'active' | 'paused' | 'revoked';
  expiresAtMs?: number;
  revokedAtMs?: number;
}

export type NodeCredentialRowLookup = (nodeId: string) => Promise<NodeCredentialRow | undefined>;

/**
 * Reference verifier for the future Edge Function. It deliberately returns the
 * same unauthorised result for unknown, revoked, expired and incorrect tokens.
 */
export function createNodeCredentialVerifier(
  lookup: NodeCredentialRowLookup,
  pepperForKeyVersion: (keyVersion: number) => Promise<string | Uint8Array> | string | Uint8Array,
  nowMs: () => number = Date.now,
): NodeCredentialVerifier {
  return async (nodeId, credential) => {
    if (!isValidNodeId(nodeId) || !isValidNodeCredential(credential)) return { authorized: false };
    const row = await lookup(nodeId);
    if (
      row === undefined || row.nodeId !== nodeId || row.nodeStatus !== 'active'
      || row.revokedAtMs !== undefined
      || (row.expiresAtMs !== undefined && row.expiresAtMs <= nowMs())
      || !/^[a-f0-9]{64}$/.test(row.credentialHmac)
      || !Number.isInteger(row.keyVersion) || row.keyVersion < 1
    ) return { authorized: false };
    let pepper: string | Uint8Array;
    try {
      pepper = await pepperForKeyVersion(row.keyVersion);
    } catch {
      return { authorized: false };
    }
    const actualHmac = await computeNodeCredentialHmac(credential, pepper);
    if (actualHmac !== row.credentialHmac) return { authorized: false };
    return { authorized: true, node: { nodeId, segmentId: row.segmentId } };
  };
}

function parseAuthorization(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const match = /^Konta2rNode ([A-Za-z0-9_-]+)$/.exec(value.trim());
  if (!match) return undefined;
  const credential = match[1];
  return credential !== undefined && isValidNodeCredential(credential) ? credential : undefined;
}

function contentTypeIsJson(value: string | undefined): boolean {
  if (value === undefined) return false;
  return value.split(';', 1)[0]?.trim().toLowerCase() === 'application/json';
}

export async function processCommunityIngestion(
  request: CommunityIngestionRequest,
  verifier: NodeCredentialVerifier,
  store: CommunityIngestionStore,
  options: { nowMs?: number; maxBodyBytes?: number } = {},
): Promise<CommunityIngestionResult> {
  if (request.method.toUpperCase() !== 'POST') {
    return { ok: false, statusCode: 405, code: 'method_not_allowed' };
  }
  if (!contentTypeIsJson(headerValue(request.headers, 'content-type'))) {
    return { ok: false, statusCode: 415, code: 'invalid_content_type' };
  }
  const bodyBytes = new TextEncoder().encode(request.bodyText).byteLength;
  const maxBodyBytes = Math.max(1024, options.maxBodyBytes ?? MAX_COMMUNITY_BODY_BYTES);
  if (bodyBytes > maxBodyBytes) {
    return { ok: false, statusCode: 413, code: 'payload_too_large' };
  }

  let envelope: CommunityUploadEnvelope;
  try {
    envelope = parseCommunityUploadJson(request.bodyText);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'invalid_json') return { ok: false, statusCode: 400, code: 'invalid_json' };
    if (message.startsWith('unsafe_payload:')) {
      return { ok: false, statusCode: 422, code: 'unsafe_payload', detail: message.slice('unsafe_payload:'.length) };
    }
    return { ok: false, statusCode: 422, code: 'invalid_payload_shape' };
  }

  const expectedSchema = headerValue(request.headers, 'x-konta2r-schema');
  const expectedMethodology = headerValue(request.headers, 'x-konta2r-methodology');
  if (expectedSchema !== envelope.schemaVersion || expectedMethodology !== envelope.methodologyVersion) {
    return { ok: false, statusCode: 422, code: 'invalid_payload_shape', detail: 'protocol headers do not match payload' };
  }

  const generatedAtMs = Date.parse(envelope.generatedAtIso);
  const nowMs = options.nowMs ?? Date.now();
  if (!Number.isFinite(generatedAtMs) || generatedAtMs > nowMs + MAX_FUTURE_CLOCK_SKEW_MS) {
    return { ok: false, statusCode: 422, code: 'future_generated_at' };
  }

  const expectedIdempotency = `${envelope.nodeId}:${envelope.sequence}`;
  if (headerValue(request.headers, 'idempotency-key') !== expectedIdempotency) {
    return { ok: false, statusCode: 409, code: 'idempotency_mismatch' };
  }

  const credential = parseAuthorization(headerValue(request.headers, 'authorization'));
  if (credential === undefined) {
    return { ok: false, statusCode: 401, code: 'invalid_authorization' };
  }
  const authorization = await verifier(envelope.nodeId, credential);
  if (!authorization.authorized) {
    return { ok: false, statusCode: 401, code: 'invalid_authorization' };
  }
  if (authorization.node.segmentId !== envelope.observedSegment.segmentId) {
    return { ok: false, statusCode: 403, code: 'segment_mismatch' };
  }

  const payloadSha256 = communityPayloadSha256(request.bodyText);
  const persisted = await store.persist({
    nodeId: envelope.nodeId,
    sequence: envelope.sequence,
    payloadSha256,
    envelope,
  });
  if (persisted.status === 'conflict') {
    return { ok: false, statusCode: 409, code: 'idempotency_conflict' };
  }
  return {
    ok: true,
    statusCode: persisted.status === 'inserted' ? 201 : 200,
    disposition: persisted.status === 'inserted' ? 'inserted' : 'duplicate',
    batchId: persisted.batchId,
    payloadSha256,
  };
}
