import { describe, expect, it } from 'vitest';
import {
  applyNodeLifecycleAction,
  type NodeCredentialRotationInput,
  type NodeLifecycleStore,
  type NodeLifecycleTransitionInput,
  type OwnedNodeLifecycleState,
} from '../../src/backend/nodeLifecycle';
import { computeNodeCredentialHmac } from '../../src/backend/nodeCredential';

const OWNER = '123e4567-e89b-42d3-a456-426614174000';
const OTHER_OWNER = '123e4567-e89b-42d3-a456-426614174001';
const NODE_ID = 'node_lifecycle01';
const PEPPER = 'lifecycle-pepper-0123456789-abcdefghijklmnopqrstuvwxyz';

class MemoryLifecycleStore implements NodeLifecycleStore {
  node: OwnedNodeLifecycleState | undefined = {
    nodeId: NODE_ID,
    ownerUserId: OWNER,
    status: 'provisioning',
  };
  transitionInputs: NodeLifecycleTransitionInput[] = [];
  rotationInputs: NodeCredentialRotationInput[] = [];
  failNextWrite = false;

  async getOwnedNode(ownerUserId: string, nodeId: string): Promise<OwnedNodeLifecycleState | undefined> {
    return this.node?.ownerUserId === ownerUserId && this.node.nodeId === nodeId
      ? { ...this.node }
      : undefined;
  }

  async applyTransition(input: NodeLifecycleTransitionInput): Promise<boolean> {
    this.transitionInputs.push(input);
    if (this.failNextWrite) {
      this.failNextWrite = false;
      return false;
    }
    if (!this.node || this.node.status !== input.expectedStatus) return false;
    this.node = { ...this.node, status: input.nextStatus };
    return true;
  }

  async rotateCredential(input: NodeCredentialRotationInput): Promise<boolean> {
    this.rotationInputs.push(input);
    if (this.failNextWrite) {
      this.failNextWrite = false;
      return false;
    }
    return this.node?.status === input.expectedStatus;
  }
}

describe('node lifecycle state machine', () => {
  it('activates provisioning nodes and pauses active nodes', async () => {
    const store = new MemoryLifecycleStore();
    const activated = await applyNodeLifecycleAction(OWNER, NODE_ID, 'activate', { store });
    expect(activated.status).toBe('active');
    expect(activated.changed).toBe(true);
    expect(store.transitionInputs[0]).toMatchObject({
      action: 'activate',
      expectedStatus: 'provisioning',
      nextStatus: 'active',
      revokeCredential: false,
    });

    const paused = await applyNodeLifecycleAction(OWNER, NODE_ID, 'pause', { store });
    expect(paused.status).toBe('paused');
    expect(store.transitionInputs[1]).toMatchObject({
      action: 'pause',
      expectedStatus: 'active',
      nextStatus: 'paused',
    });
  });

  it('treats repeated activate/pause/revoke calls as idempotent no-ops where valid', async () => {
    const store = new MemoryLifecycleStore();
    store.node = { nodeId: NODE_ID, ownerUserId: OWNER, status: 'active' };
    const activeAgain = await applyNodeLifecycleAction(OWNER, NODE_ID, 'activate', { store });
    expect(activeAgain.changed).toBe(false);
    expect(store.transitionInputs).toHaveLength(0);

    await applyNodeLifecycleAction(OWNER, NODE_ID, 'pause', { store });
    const pauseAgain = await applyNodeLifecycleAction(OWNER, NODE_ID, 'pause', { store });
    expect(pauseAgain.changed).toBe(false);

    await applyNodeLifecycleAction(OWNER, NODE_ID, 'revoke', { store });
    const revokeAgain = await applyNodeLifecycleAction(OWNER, NODE_ID, 'revoke', { store });
    expect(revokeAgain.changed).toBe(false);
  });

  it('makes revocation terminal and revokes the credential atomically with state transition', async () => {
    const store = new MemoryLifecycleStore();
    store.node = { nodeId: NODE_ID, ownerUserId: OWNER, status: 'active' };

    const revoked = await applyNodeLifecycleAction(OWNER, NODE_ID, 'revoke', { store });
    expect(revoked.status).toBe('revoked');
    expect(store.transitionInputs[0]).toMatchObject({
      action: 'revoke',
      expectedStatus: 'active',
      nextStatus: 'revoked',
      revokeCredential: true,
    });

    await expect(applyNodeLifecycleAction(OWNER, NODE_ID, 'activate', { store }))
      .rejects.toThrow('Invalid node lifecycle transition');
    await expect(applyNodeLifecycleAction(OWNER, NODE_ID, 'rotate', { store, pepper: PEPPER }))
      .rejects.toThrow('Revoked nodes cannot rotate');
  });

  it('rotates only credential material while preserving node id and status', async () => {
    const store = new MemoryLifecycleStore();
    store.node = { nodeId: NODE_ID, ownerUserId: OWNER, status: 'paused' };
    const rotated = await applyNodeLifecycleAction(OWNER, NODE_ID, 'rotate', {
      store,
      pepper: PEPPER,
      keyVersion: 5,
      randomFill: (bytes) => bytes.fill(41),
    });

    expect(rotated.nodeId).toBe(NODE_ID);
    expect(rotated.status).toBe('paused');
    expect(rotated.previousStatus).toBe('paused');
    expect(rotated.changed).toBe(true);
    expect(rotated.credential).toMatch(/^k2n_v1_/);
    expect(rotated.credentialVersion).toBe(5);
    expect(store.rotationInputs).toHaveLength(1);
    expect(store.rotationInputs[0]).toMatchObject({
      nodeId: NODE_ID,
      ownerUserId: OWNER,
      expectedStatus: 'paused',
      keyVersion: 5,
    });
    expect(store.rotationInputs[0]).not.toHaveProperty('credential');
    expect(store.rotationInputs[0]?.credentialHmac).toBe(
      await computeNodeCredentialHmac(rotated.credential!, PEPPER),
    );
  });

  it('rejects invalid ownership and invalid lifecycle edges', async () => {
    const store = new MemoryLifecycleStore();
    await expect(applyNodeLifecycleAction(OTHER_OWNER, NODE_ID, 'activate', { store }))
      .rejects.toThrow('not found');

    await expect(applyNodeLifecycleAction(OWNER, NODE_ID, 'pause', { store }))
      .rejects.toThrow('Invalid node lifecycle transition');
  });

  it('fails on optimistic-concurrency races instead of overwriting a newer state', async () => {
    const store = new MemoryLifecycleStore();
    store.node = { nodeId: NODE_ID, ownerUserId: OWNER, status: 'active' };
    store.failNextWrite = true;

    await expect(applyNodeLifecycleAction(OWNER, NODE_ID, 'pause', { store }))
      .rejects.toThrow('state changed');
  });

  it('requires server pepper for rotation and never for ordinary transitions', async () => {
    const store = new MemoryLifecycleStore();
    store.node = { nodeId: NODE_ID, ownerUserId: OWNER, status: 'active' };
    await expect(applyNodeLifecycleAction(OWNER, NODE_ID, 'rotate', { store }))
      .rejects.toThrow('pepper');

    await expect(applyNodeLifecycleAction(OWNER, NODE_ID, 'pause', { store }))
      .resolves.toMatchObject({ status: 'paused' });
  });
});
