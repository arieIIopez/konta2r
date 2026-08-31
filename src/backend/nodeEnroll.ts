import {
  createNodeEnrollmentMaterial,
  type NodeEnrollmentMaterial,
  type SecureRandomFill,
} from './nodeCredential';

export interface NodeEnrollRequest {
  label: string;
  segmentId: string;
}

export interface NodeEnrollPersistenceInput {
  ownerUserId: string;
  nodeId: string;
  label: string;
  segmentId: string;
  status: 'provisioning';
  credentialHmac: string;
  keyVersion: number;
}

export interface NodeEnrollStore {
  segmentExists(segmentId: string): Promise<boolean>;
  /** Must atomically create public.nodes + private.node_credentials. */
  persistEnrollment(input: NodeEnrollPersistenceInput): Promise<void>;
}

export interface NodeEnrollDependencies {
  store: NodeEnrollStore;
  pepper: string | Uint8Array;
  keyVersion?: number;
  randomFill?: SecureRandomFill;
}

export interface NodeEnrollResult {
  nodeId: string;
  credential: string;
  label: string;
  segmentId: string;
  status: 'provisioning';
  keyVersion: number;
}

function uuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function normalizeRequest(request: NodeEnrollRequest): NodeEnrollRequest {
  const label = request.label.trim();
  const segmentId = request.segmentId.trim();
  if (label.length < 1 || label.length > 120) {
    throw new Error('Node label must contain 1..120 characters');
  }
  if (segmentId.length < 1 || segmentId.length > 160) {
    throw new Error('Node segmentId must contain 1..160 characters');
  }
  return { label, segmentId };
}

/**
 * Human-authenticated enrollment boundary. ownerUserId must come from a verified
 * Supabase Auth JWT; callers must never accept owner identity from request JSON.
 * The raw node credential is returned once and deliberately omitted from the
 * persistence input.
 */
export async function enrollNodeForAuthenticatedUser(
  ownerUserId: string,
  request: NodeEnrollRequest,
  dependencies: NodeEnrollDependencies,
): Promise<NodeEnrollResult> {
  if (!uuidLike(ownerUserId)) throw new Error('Verified owner user id is required');
  const normalized = normalizeRequest(request);
  if (!await dependencies.store.segmentExists(normalized.segmentId)) {
    throw new Error('Observed segment does not exist');
  }

  const options: {
    keyVersion?: number;
    randomFill?: SecureRandomFill;
  } = {};
  if (dependencies.keyVersion !== undefined) options.keyVersion = dependencies.keyVersion;
  if (dependencies.randomFill !== undefined) options.randomFill = dependencies.randomFill;

  const material: NodeEnrollmentMaterial = await createNodeEnrollmentMaterial(
    dependencies.pepper,
    options,
  );

  await dependencies.store.persistEnrollment({
    ownerUserId,
    nodeId: material.nodeId,
    label: normalized.label,
    segmentId: normalized.segmentId,
    status: 'provisioning',
    credentialHmac: material.credentialHmac,
    keyVersion: material.keyVersion,
  });

  return {
    nodeId: material.nodeId,
    credential: material.credential,
    label: normalized.label,
    segmentId: normalized.segmentId,
    status: 'provisioning',
    keyVersion: material.keyVersion,
  };
}
