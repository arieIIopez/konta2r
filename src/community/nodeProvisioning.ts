import { isValidNodeCredential, isValidNodeId } from '../backend/nodeCredential';
import type { NodeOperationalStatus } from '../backend/communityIngest';
import type { NodeAdminClient, NodeEnrollmentResponse, NodeLifecycleResponse } from './nodeAdminClient';

export interface LocalNodeIdentity {
  nodeId: string;
  label: string;
  segmentId: string;
  status: NodeOperationalStatus;
  credential?: string;
  credentialVersion: number;
  enrolledAtIso: string;
  updatedAtIso: string;
}

export interface NodeIdentityStore {
  get(): Promise<LocalNodeIdentity | undefined>;
  put(identity: LocalNodeIdentity): Promise<void>;
  clear(): Promise<void>;
}

export interface ActiveNodeCredential {
  nodeId: string;
  credential: string;
  credentialVersion: number;
  segmentId: string;
}

export interface NodeProvisioner {
  identity(): Promise<LocalNodeIdentity | undefined>;
  enroll(input: { label: string; segmentId: string }): Promise<LocalNodeIdentity>;
  provision(input: { label: string; segmentId: string }): Promise<LocalNodeIdentity>;
  activate(): Promise<LocalNodeIdentity>;
  pause(): Promise<LocalNodeIdentity>;
  rotate(): Promise<LocalNodeIdentity>;
  revoke(): Promise<LocalNodeIdentity>;
  activeCredential(): Promise<ActiveNodeCredential | undefined>;
  clearRevoked(): Promise<void>;
}

export interface NodeProvisionerOptions {
  admin: NodeAdminClient;
  store: NodeIdentityStore;
  nowIso?: () => string;
}

function assertEnrollment(result: NodeEnrollmentResponse): void {
  if (!isValidNodeId(result.node.nodeId)) throw new Error('Enrollment returned an invalid node id');
  if (!isValidNodeCredential(result.credential)) throw new Error('Enrollment returned an invalid node credential');
  if (!Number.isInteger(result.credentialVersion) || result.credentialVersion < 1) {
    throw new Error('Enrollment returned an invalid credential version');
  }
  if (result.node.status !== 'provisioning') {
    throw new Error('New Konta2r nodes must start in provisioning state');
  }
}

function assertLifecycle(identity: LocalNodeIdentity, result: NodeLifecycleResponse): void {
  if (result.node.nodeId !== identity.nodeId) {
    throw new Error('Lifecycle response changed the local node identity');
  }
}

function timestamp(nowIso: () => string): string {
  const value = nowIso();
  if (!Number.isFinite(Date.parse(value))) throw new Error('Node provisioning clock returned an invalid timestamp');
  return value;
}

export function createNodeProvisioner(options: NodeProvisionerOptions): NodeProvisioner {
  const nowIso = options.nowIso ?? (() => new Date().toISOString());

  async function requireIdentity(): Promise<LocalNodeIdentity> {
    const identity = await options.store.get();
    if (!identity) throw new Error('This device has not been enrolled as a Konta2r node');
    return identity;
  }

  async function saveStatus(
    identity: LocalNodeIdentity,
    result: NodeLifecycleResponse,
  ): Promise<LocalNodeIdentity> {
    assertLifecycle(identity, result);
    const updated: LocalNodeIdentity = {
      ...identity,
      status: result.node.status,
      updatedAtIso: timestamp(nowIso),
    };
    await options.store.put(updated);
    return updated;
  }

  return {
    identity: () => options.store.get(),

    async enroll(input): Promise<LocalNodeIdentity> {
      const existing = await options.store.get();
      if (existing && existing.status !== 'revoked') {
        throw new Error('This device is already enrolled as a Konta2r node');
      }

      const result = await options.admin.enroll(input);
      assertEnrollment(result);
      const now = timestamp(nowIso);
      const identity: LocalNodeIdentity = {
        nodeId: result.node.nodeId,
        label: result.node.label,
        segmentId: result.node.segmentId,
        status: result.node.status,
        credential: result.credential,
        credentialVersion: result.credentialVersion,
        enrolledAtIso: now,
        updatedAtIso: now,
      };
      await options.store.put(identity);
      return identity;
    },

    async provision(input): Promise<LocalNodeIdentity> {
      await this.enroll(input);
      return this.activate();
    },

    async activate(): Promise<LocalNodeIdentity> {
      const identity = await requireIdentity();
      if (identity.status === 'revoked') throw new Error('Revoked nodes cannot be activated');
      if (!identity.credential || !isValidNodeCredential(identity.credential)) {
        throw new Error('Local node credential is unavailable');
      }
      const result = await options.admin.lifecycle(identity.nodeId, 'activate');
      return saveStatus(identity, result);
    },

    async pause(): Promise<LocalNodeIdentity> {
      const identity = await requireIdentity();
      if (identity.status === 'revoked') throw new Error('Revoked nodes cannot be paused');
      const result = await options.admin.lifecycle(identity.nodeId, 'pause');
      return saveStatus(identity, result);
    },

    async rotate(): Promise<LocalNodeIdentity> {
      const identity = await requireIdentity();
      if (identity.status === 'revoked') throw new Error('Revoked nodes cannot rotate credentials');
      const result = await options.admin.lifecycle(identity.nodeId, 'rotate');
      assertLifecycle(identity, result);
      if (!result.credential || !isValidNodeCredential(result.credential)) {
        throw new Error('Credential rotation did not return a valid one-time credential');
      }
      if (!Number.isInteger(result.credentialVersion) || (result.credentialVersion ?? 0) < 1) {
        throw new Error('Credential rotation returned an invalid credential version');
      }
      const updated: LocalNodeIdentity = {
        ...identity,
        status: result.node.status,
        credential: result.credential,
        credentialVersion: result.credentialVersion,
        updatedAtIso: timestamp(nowIso),
      };
      await options.store.put(updated);
      return updated;
    },

    async revoke(): Promise<LocalNodeIdentity> {
      const identity = await requireIdentity();
      if (identity.status === 'revoked') return identity;
      const result = await options.admin.lifecycle(identity.nodeId, 'revoke');
      assertLifecycle(identity, result);
      if (result.node.status !== 'revoked') throw new Error('Revocation did not produce terminal revoked state');
      const updated: LocalNodeIdentity = {
        ...identity,
        status: 'revoked',
        credential: undefined,
        updatedAtIso: timestamp(nowIso),
      };
      await options.store.put(updated);
      return updated;
    },

    async activeCredential(): Promise<ActiveNodeCredential | undefined> {
      const identity = await options.store.get();
      if (identity?.status !== 'active' || !identity.credential || !isValidNodeCredential(identity.credential)) {
        return undefined;
      }
      return {
        nodeId: identity.nodeId,
        credential: identity.credential,
        credentialVersion: identity.credentialVersion,
        segmentId: identity.segmentId,
      };
    },

    async clearRevoked(): Promise<void> {
      const identity = await options.store.get();
      if (!identity) return;
      if (identity.status !== 'revoked') {
        throw new Error('Only a locally revoked node identity can be cleared');
      }
      await options.store.clear();
    },
  };
}
