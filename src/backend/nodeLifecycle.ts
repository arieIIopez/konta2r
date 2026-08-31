import {
  createNodeEnrollmentMaterial,
  isValidNodeId,
  type SecureRandomFill,
} from './nodeCredential.ts';
import type { NodeOperationalStatus } from './communityIngest.ts';

export type NodeLifecycleAction = 'activate' | 'pause' | 'revoke' | 'rotate';

export interface OwnedNodeLifecycleState {
  nodeId: string;
  ownerUserId: string;
  status: NodeOperationalStatus;
}

export interface NodeLifecycleTransitionInput {
  nodeId: string;
  ownerUserId: string;
  action: Exclude<NodeLifecycleAction, 'rotate'>;
  expectedStatus: NodeOperationalStatus;
  nextStatus: NodeOperationalStatus;
  revokeCredential: boolean;
}

export interface NodeCredentialRotationInput {
  nodeId: string;
  ownerUserId: string;
  expectedStatus: Exclude<NodeOperationalStatus, 'revoked'>;
  credentialHmac: string;
  keyVersion: number;
}

export interface NodeLifecycleStore {
  getOwnedNode(ownerUserId: string, nodeId: string): Promise<OwnedNodeLifecycleState | undefined>;
  /** Must change node status, credential revocation if requested and append an audit event atomically. */
  applyTransition(input: NodeLifecycleTransitionInput): Promise<boolean>;
  /** Must replace the HMAC/key version and append an audit event atomically. */
  rotateCredential(input: NodeCredentialRotationInput): Promise<boolean>;
}

export interface NodeLifecycleDependencies {
  store: NodeLifecycleStore;
  pepper?: string | Uint8Array;
  keyVersion?: number;
  randomFill?: SecureRandomFill;
}

export interface NodeLifecycleResult {
  nodeId: string;
  action: NodeLifecycleAction;
  previousStatus: NodeOperationalStatus;
  status: NodeOperationalStatus;
  changed: boolean;
  /** Present only for rotation. Return once and never persist server-side. */
  credential?: string;
  credentialVersion?: number;
}

function validOwnerUserId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function transitionFor(
  action: Exclude<NodeLifecycleAction, 'rotate'>,
  status: NodeOperationalStatus,
): NodeOperationalStatus | undefined {
  if (action === 'activate') {
    if (status === 'active') return 'active';
    if (status === 'provisioning' || status === 'paused') return 'active';
    return undefined;
  }
  if (action === 'pause') {
    if (status === 'paused') return 'paused';
    if (status === 'active') return 'paused';
    return undefined;
  }
  if (status === 'revoked') return 'revoked';
  return 'revoked';
}

/**
 * Human-authorized lifecycle policy. The owner id must already be verified by
 * Supabase Auth. A revoked node is terminal: rotation/activation cannot resurrect
 * an exposed credential. Reuse requires a new node enrollment.
 */
export async function applyNodeLifecycleAction(
  ownerUserId: string,
  nodeId: string,
  action: NodeLifecycleAction,
  dependencies: NodeLifecycleDependencies,
): Promise<NodeLifecycleResult> {
  if (!validOwnerUserId(ownerUserId)) throw new Error('Verified owner user id is required');
  if (!isValidNodeId(nodeId)) throw new Error('Invalid Konta2r node id');

  const node = await dependencies.store.getOwnedNode(ownerUserId, nodeId);
  if (!node) throw new Error('Node not found for authenticated owner');

  if (action === 'rotate') {
    if (node.status === 'revoked') throw new Error('Revoked nodes cannot rotate credentials');
    if (dependencies.pepper === undefined) throw new Error('Credential pepper is required for rotation');

    const options: { keyVersion?: number; randomFill?: SecureRandomFill } = {};
    if (dependencies.keyVersion !== undefined) options.keyVersion = dependencies.keyVersion;
    if (dependencies.randomFill !== undefined) options.randomFill = dependencies.randomFill;
    const material = await createNodeEnrollmentMaterial(dependencies.pepper, options);

    const applied = await dependencies.store.rotateCredential({
      nodeId,
      ownerUserId,
      expectedStatus: node.status,
      credentialHmac: material.credentialHmac,
      keyVersion: material.keyVersion,
    });
    if (!applied) throw new Error('Node state changed during credential rotation');

    return {
      nodeId,
      action,
      previousStatus: node.status,
      status: node.status,
      changed: true,
      credential: material.credential,
      credentialVersion: material.keyVersion,
    };
  }

  const nextStatus = transitionFor(action, node.status);
  if (nextStatus === undefined) {
    throw new Error(`Invalid node lifecycle transition: ${node.status} -> ${action}`);
  }
  if (nextStatus === node.status) {
    return {
      nodeId,
      action,
      previousStatus: node.status,
      status: node.status,
      changed: false,
    };
  }

  const applied = await dependencies.store.applyTransition({
    nodeId,
    ownerUserId,
    action,
    expectedStatus: node.status,
    nextStatus,
    revokeCredential: action === 'revoke',
  });
  if (!applied) throw new Error('Node state changed during lifecycle transition');

  return {
    nodeId,
    action,
    previousStatus: node.status,
    status: nextStatus,
    changed: true,
  };
}
