import { describe, expect, it } from 'vitest';
import type {
  NodeAdminClient,
  NodeEnrollmentResponse,
  NodeLifecycleResponse,
} from '../../src/community/nodeAdminClient';
import {
  createNodeProvisioner,
  type LocalNodeIdentity,
  type NodeIdentityStore,
} from '../../src/community/nodeProvisioning';

const NODE_ID = 'node_provision01';
const CREDENTIAL_1 = `k2n_v1_${'A'.repeat(43)}`;
const CREDENTIAL_2 = `k2n_v1_${'B'.repeat(43)}`;

class MemoryIdentityStore implements NodeIdentityStore {
  value: LocalNodeIdentity | undefined;

  async get(): Promise<LocalNodeIdentity | undefined> {
    return this.value === undefined ? undefined : { ...this.value };
  }

  async put(identity: LocalNodeIdentity): Promise<void> {
    this.value = { ...identity };
  }

  async clear(): Promise<void> {
    this.value = undefined;
  }
}

class MemoryAdminClient implements NodeAdminClient {
  status: LocalNodeIdentity['status'] = 'provisioning';
  credential = CREDENTIAL_1;
  credentialVersion = 1;
  failActivation = false;
  actions: string[] = [];

  async enroll(input: { label: string; segmentId: string }): Promise<NodeEnrollmentResponse> {
    this.status = 'provisioning';
    return {
      node: {
        nodeId: NODE_ID,
        label: input.label,
        segmentId: input.segmentId,
        status: this.status,
      },
      credential: this.credential,
      credentialVersion: this.credentialVersion,
    };
  }

  async lifecycle(nodeId: string, action: 'activate' | 'pause' | 'revoke' | 'rotate'): Promise<NodeLifecycleResponse> {
    this.actions.push(action);
    if (nodeId !== NODE_ID) throw new Error('wrong node');
    if (action === 'activate' && this.failActivation) throw new Error('network failed');
    const previousStatus = this.status;
    if (action === 'activate') this.status = 'active';
    if (action === 'pause') this.status = 'paused';
    if (action === 'revoke') this.status = 'revoked';
    if (action === 'rotate') {
      this.credential = CREDENTIAL_2;
      this.credentialVersion = 2;
    }
    return {
      action,
      changed: action === 'rotate' || previousStatus !== this.status,
      node: { nodeId, previousStatus, status: this.status },
      ...(action === 'rotate' ? {
        credential: this.credential,
        credentialVersion: this.credentialVersion,
      } : {}),
    };
  }
}

function provisioner(admin = new MemoryAdminClient(), store = new MemoryIdentityStore()) {
  let second = 0;
  return {
    admin,
    store,
    subject: createNodeProvisioner({
      admin,
      store,
      nowIso: () => `2026-09-01T00:00:0${second++}.000Z`,
    }),
  };
}

describe('local node provisioning', () => {
  it('enrolls first, persists the one-time credential, then activates the same node', async () => {
    const { subject, store } = provisioner();
    const identity = await subject.provision({ label: 'Teléfono ventana', segmentId: 'osm:way:100' });

    expect(identity).toMatchObject({
      nodeId: NODE_ID,
      status: 'active',
      credential: CREDENTIAL_1,
      credentialVersion: 1,
      segmentId: 'osm:way:100',
    });
    expect(store.value?.status).toBe('active');
    await expect(subject.activeCredential()).resolves.toMatchObject({
      nodeId: NODE_ID,
      credential: CREDENTIAL_1,
    });
  });

  it('keeps the provisioning identity locally when activation fails so it can be retried', async () => {
    const admin = new MemoryAdminClient();
    admin.failActivation = true;
    const { subject, store } = provisioner(admin);

    await expect(subject.provision({ label: 'Nodo recuperable', segmentId: 'osm:way:200' }))
      .rejects.toThrow('network failed');
    expect(store.value).toMatchObject({
      nodeId: NODE_ID,
      status: 'provisioning',
      credential: CREDENTIAL_1,
    });

    admin.failActivation = false;
    await expect(subject.activate()).resolves.toMatchObject({ status: 'active' });
  });

  it('rotates the credential without changing node identity or operational status', async () => {
    const { subject } = provisioner();
    const active = await subject.provision({ label: 'Nodo', segmentId: 'osm:way:300' });
    const rotated = await subject.rotate();

    expect(rotated.nodeId).toBe(active.nodeId);
    expect(rotated.status).toBe('active');
    expect(rotated.credential).toBe(CREDENTIAL_2);
    expect(rotated.credentialVersion).toBe(2);
    await expect(subject.activeCredential()).resolves.toMatchObject({ credential: CREDENTIAL_2 });
  });

  it('removes the raw local credential after server-confirmed terminal revocation', async () => {
    const { subject, store } = provisioner();
    await subject.provision({ label: 'Nodo', segmentId: 'osm:way:400' });
    const revoked = await subject.revoke();

    expect(revoked.status).toBe('revoked');
    expect(revoked).not.toHaveProperty('credential');
    expect(store.value).not.toHaveProperty('credential');
    await expect(subject.activeCredential()).resolves.toBeUndefined();
    await expect(subject.activate()).rejects.toThrow('Revoked nodes');
  });

  it('does not overwrite an active local identity and only clears terminal identities', async () => {
    const { subject, store } = provisioner();
    await subject.provision({ label: 'Nodo', segmentId: 'osm:way:500' });

    await expect(subject.enroll({ label: 'Segundo', segmentId: 'osm:way:501' }))
      .rejects.toThrow('already enrolled');
    await expect(subject.clearRevoked()).rejects.toThrow('Only a locally revoked');

    await subject.revoke();
    await subject.clearRevoked();
    expect(store.value).toBeUndefined();
  });
});
