import { describe, expect, it } from 'vitest';
import type { NodeControlClient, NodeControlNodeResult } from '../../src/backend/nodeControlClient';
import {
  createNodeProvisioningCoordinator,
  validateLocalNodeBinding,
  type LocalNodeBinding,
  type NodeLocalBindingStore,
} from '../../src/backend/nodeLocalBinding';
import type { NodeLifecycleAction } from '../../src/backend/nodeLifecycle';

const NODE_ID = 'node_binding01';

class MemoryStore implements NodeLocalBindingStore {
  value: LocalNodeBinding | undefined;

  async get(): Promise<LocalNodeBinding | undefined> {
    return this.value ? { ...this.value } : undefined;
  }
  async put(binding: LocalNodeBinding): Promise<void> { this.value = { ...binding }; }
  async clear(): Promise<void> { this.value = undefined; }
}

class FakeControl implements NodeControlClient {
  calls: Array<{ action: 'enroll' | NodeLifecycleAction; nodeId?: string }> = [];
  enrollResult: NodeControlNodeResult = {
    nodeId: NODE_ID,
    label: 'Ventana norte',
    segmentId: 'seg-42',
    status: 'provisioning',
    credentialVersion: 1,
    credentialStored: true,
  };
  lifecycleResult: NodeControlNodeResult = {
    nodeId: NODE_ID,
    previousStatus: 'provisioning',
    status: 'active',
    credentialStored: false,
  };

  async enroll(): Promise<NodeControlNodeResult> {
    this.calls.push({ action: 'enroll' });
    return { ...this.enrollResult };
  }

  async lifecycle(nodeId: string, action: NodeLifecycleAction): Promise<NodeControlNodeResult> {
    this.calls.push({ action, nodeId });
    return { ...this.lifecycleResult };
  }
}

describe('local node binding', () => {
  it('persists only non-secret metadata after credential custody succeeds', async () => {
    const store = new MemoryStore();
    const control = new FakeControl();
    const coordinator = createNodeProvisioningCoordinator({ control, store, nowMs: () => 1000 });

    const binding = await coordinator.enroll('Ventana norte', 'seg-42');
    expect(binding).toEqual({
      schemaVersion: '1',
      nodeId: NODE_ID,
      label: 'Ventana norte',
      segmentId: 'seg-42',
      status: 'provisioning',
      credentialVersion: 1,
      updatedAtMs: 1000,
    });
    expect(JSON.stringify(binding)).not.toMatch(/k2n_v1_|credential":"/);
    expect(await coordinator.current()).toEqual(binding);
  });

  it('updates cached status after human-authorized lifecycle changes', async () => {
    const store = new MemoryStore();
    const control = new FakeControl();
    const coordinator = createNodeProvisioningCoordinator({ control, store, nowMs: () => 2000 });
    await coordinator.enroll('Ventana norte', 'seg-42');

    control.lifecycleResult = {
      nodeId: NODE_ID,
      previousStatus: 'provisioning',
      status: 'active',
      credentialStored: false,
    };
    const active = await coordinator.lifecycle('activate');
    expect(active.status).toBe('active');
    expect(active.credentialVersion).toBe(1);
    expect(control.calls.at(-1)).toEqual({ action: 'activate', nodeId: NODE_ID });
  });

  it('updates only credential version metadata after rotation', async () => {
    const store = new MemoryStore();
    const control = new FakeControl();
    const coordinator = createNodeProvisioningCoordinator({ control, store, nowMs: () => 3000 });
    await coordinator.enroll('Ventana norte', 'seg-42');

    control.lifecycleResult = {
      nodeId: NODE_ID,
      previousStatus: 'provisioning',
      status: 'provisioning',
      credentialVersion: 4,
      credentialStored: true,
    };
    const rotated = await coordinator.lifecycle('rotate');
    expect(rotated.status).toBe('provisioning');
    expect(rotated.credentialVersion).toBe(4);
    expect(rotated).not.toHaveProperty('credential');
  });

  it('retains revoked binding as restart context while server remains authoritative', async () => {
    const store = new MemoryStore();
    const control = new FakeControl();
    const coordinator = createNodeProvisioningCoordinator({ control, store, nowMs: () => 4000 });
    await coordinator.enroll('Ventana norte', 'seg-42');

    control.lifecycleResult = {
      nodeId: NODE_ID,
      previousStatus: 'provisioning',
      status: 'revoked',
      credentialStored: false,
    };
    const revoked = await coordinator.lifecycle('revoke');
    expect(revoked.status).toBe('revoked');
    expect(await coordinator.current()).toMatchObject({ nodeId: NODE_ID, status: 'revoked' });

    await coordinator.clearLocalBinding();
    expect(await coordinator.current()).toBeUndefined();
  });

  it('does not perform lifecycle operations when this device has no binding', async () => {
    const store = new MemoryStore();
    const control = new FakeControl();
    const coordinator = createNodeProvisioningCoordinator({ control, store });
    await expect(coordinator.lifecycle('activate')).rejects.toThrow('not bound');
    expect(control.calls).toHaveLength(0);
  });

  it('rejects malformed persisted metadata rather than treating it as identity', () => {
    expect(() => validateLocalNodeBinding({
      schemaVersion: '1',
      nodeId: 'not-a-node',
      label: 'Nodo',
      segmentId: 'seg-1',
      status: 'active',
      updatedAtMs: 1,
    })).toThrow('node id');
  });
});
