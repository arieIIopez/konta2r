import { computeNodeCredentialHmac, isValidNodeCredential } from './nodeCredential.ts';
import {
  validateCommunityUpload,
  type CommunityUploadEnvelope,
} from '../community/protocol.ts';

export type NodeOperationalStatus = 'provisioning' | 'active' | 'paused' | 'revoked';

export interface CommunityIngestNodeState {
  nodeId: string;
  status: NodeOperationalStatus;
  segmentId?: string;
  credentialHmac: string;
  keyVersion: number;
  credentialExpiresAtMs?: number;
  credentialRevokedAtMs?: number;
}

export interface CommunityIngestPersistenceInput {
  envelope: CommunityUploadEnvelope;
  payloadSha256: string;
  receivedAtIso: string;
}

export type CommunityIngestPersistenceResult =
  | { outcome: 'inserted'; batchId: string }
  | { outcome: 'duplicate'; batchId: string; existingPayloadSha256: string }
  | { outcome: 'sequence_conflict'; batchId: string; existingPayloadSha256: string };

export interface CommunityIngestStore {
  getNodeState(nodeId: string): Promise<CommunityIngestNodeState | undefined>;
  /** Must persist batch + aggregate records atomically and enforce (node_id, sequence). */
  persistCommunityUpload(input: CommunityIngestPersistenceInput): Promise<CommunityIngestPersistenceResult>;
}

export interface CommunityIngestDependencies {
  store: CommunityIngestStore;
  pepperForKeyVersion: (
    keyVersion: number,
  ) => Promise<string | Uint8Array | undefined> | string | Uint8Array | undefined;
  nowMs?: () => number;
}

export interface CommunityIngestRequest {
  authorization?: string;
  idempotencyKey?: string;
  body: unknown;
}

export interface CommunityIngestDecision {
  statusCode: number;
  outcome: 'accepted' | 'duplicate' | 'rejected' | 'conflict';
  code: string;
  batchId?: string;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function structurallyUsableEnvelope(value: unknown): CommunityUploadEnvelope | undefined {
  const root = record(value);
  if (!root) return undefined;
  const observedSegment = record(root.observedSegment);
  const runtime = record(root.runtime);
  const quality = record(root.quality);
  if (!observedSegment || !runtime || !quality || !Array.isArray(root.records)) return undefined;
  if (typeof root.nodeId !== 'string' || typeof root.sequence !== 'number') return undefined;
  if (typeof root.generatedAtIso !== 'string') return undefined;
  if (typeof observedSegment.segmentId !== 'string') return undefined;
  return value as CommunityUploadEnvelope;
}

export function parseNodeAuthorization(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = /^Konta2rNode\s+(\S+)$/.exec(value.trim());
  if (!match) return undefined;
  const credential = match[1];
  return credential && isValidNodeCredential(credential) ? credential : undefined;
}

function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Non-finite numbers are not canonical JSON');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => item === undefined ? 'null' : canonicalJson(item)).join(',')}]`;
  }
  const object = record(value);
  if (!object) throw new Error('Unsupported canonical JSON value');
  const keys = Object.keys(object)
    .filter((key) => object[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
}

function ownBuffer(value: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(new ArrayBuffer(value.byteLength));
  copy.set(value);
  return copy;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export async function communityPayloadSha256(envelope: CommunityUploadEnvelope): Promise<string> {
  const bytes = ownBuffer(new TextEncoder().encode(canonicalJson(envelope)));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return bytesToHex(new Uint8Array(digest));
}

function constantTimeHexEqual(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

function reject(statusCode: number, code: string): CommunityIngestDecision {
  return { statusCode, outcome: 'rejected', code };
}

/**
 * Pure ingest policy used by the future Supabase Edge Function. It authenticates
 * the sensor independently of human OAuth, binds the upload to its configured
 * segment and delegates one atomic persistence operation to the store adapter.
 */
export async function evaluateCommunityIngest(
  request: CommunityIngestRequest,
  dependencies: CommunityIngestDependencies,
): Promise<CommunityIngestDecision> {
  const envelope = structurallyUsableEnvelope(request.body);
  if (!envelope) return reject(422, 'invalid_community_payload');

  let validation;
  try {
    validation = validateCommunityUpload(envelope);
  } catch {
    return reject(422, 'invalid_community_payload');
  }
  if (!validation.valid) return reject(422, 'invalid_community_payload');

  const expectedIdempotencyKey = `${envelope.nodeId}:${envelope.sequence}`;
  if (request.idempotencyKey !== expectedIdempotencyKey) {
    return reject(400, 'idempotency_key_mismatch');
  }

  const credential = parseNodeAuthorization(request.authorization);
  if (!credential) return reject(401, 'invalid_node_auth');

  const node = await dependencies.store.getNodeState(envelope.nodeId);
  if (!node || node.nodeId !== envelope.nodeId) return reject(401, 'invalid_node_auth');
  if (node.status === 'revoked' || node.credentialRevokedAtMs !== undefined) {
    return reject(401, 'invalid_node_auth');
  }
  if (node.status !== 'active') return reject(403, 'node_not_active');

  const nowMs = dependencies.nowMs?.() ?? Date.now();
  if (node.credentialExpiresAtMs !== undefined && node.credentialExpiresAtMs <= nowMs) {
    return reject(401, 'invalid_node_auth');
  }

  if (!node.segmentId || node.segmentId !== envelope.observedSegment.segmentId) {
    return reject(403, 'segment_not_authorized');
  }

  const pepper = await dependencies.pepperForKeyVersion(node.keyVersion);
  if (pepper === undefined) return reject(503, 'credential_key_unavailable');

  let suppliedHmac: string;
  try {
    suppliedHmac = await computeNodeCredentialHmac(credential, pepper);
  } catch {
    return reject(401, 'invalid_node_auth');
  }
  if (!constantTimeHexEqual(suppliedHmac, node.credentialHmac)) {
    return reject(401, 'invalid_node_auth');
  }

  const payloadSha256 = await communityPayloadSha256(envelope);
  const persistence = await dependencies.store.persistCommunityUpload({
    envelope,
    payloadSha256,
    receivedAtIso: new Date(nowMs).toISOString(),
  });

  if (persistence.outcome === 'inserted') {
    return {
      statusCode: 202,
      outcome: 'accepted',
      code: 'community_upload_accepted',
      batchId: persistence.batchId,
    };
  }

  if (
    persistence.outcome === 'duplicate'
    && constantTimeHexEqual(payloadSha256, persistence.existingPayloadSha256)
  ) {
    return {
      statusCode: 200,
      outcome: 'duplicate',
      code: 'community_upload_already_accepted',
      batchId: persistence.batchId,
    };
  }

  return {
    statusCode: 409,
    outcome: 'conflict',
    code: 'sequence_payload_conflict',
    batchId: persistence.batchId,
  };
}
