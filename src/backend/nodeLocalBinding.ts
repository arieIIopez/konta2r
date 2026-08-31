import { isValidNodeId } from './nodeCredential.ts';
import type { NodeControlClient, NodeControlNodeResult } from './nodeControlClient.ts';
import type { NodeLifecycleAction } from './nodeLifecycle.ts';

export type LocalNodeStatus = 'provisioning' | 'active' | 'paused' | 'revoked';

export interface LocalNodeBinding {
  schemaVersion: '1';
  nodeId: string;
  label: string;
  segmentId: string;
  /** Cached convenience only. Backend node state remains authoritative. */
  status: LocalNodeStatus;
  credentialVersion?: number;
  updatedAtMs: number;
}

export interface NodeLocalBindingStore {
  get(): Promise<LocalNodeBinding | undefined>;
  put(binding: LocalNodeBinding): Promise<void>;
  clear(): Promise<void>;
}

export interface NodeProvisioningCoordinator {
  current(): Promise<LocalNodeBinding | undefined>;
  enroll(label: string, segmentId: string): Promise<LocalNodeBinding>;
  lifecycle(action: NodeLifecycleAction): Promise<LocalNodeBinding>;
  clearLocalBinding(): Promise<void>;
}

function validStatus(value: string): value is LocalNodeStatus {
  return ['provisioning', 'active', 'paused', 'revoked'].includes(value);
}

export function validateLocalNodeBinding(binding: LocalNodeBinding): void {
  if (binding.schemaVersion !== '1') throw new Error('Unsupported local node binding schema');
  if (!isValidNodeId(binding.nodeId)) throw new Error('Invalid local node id');
  if (binding.label.trim().length < 1 || binding.label.trim().length > 120) {
    throw new Error('Invalid local node label');
  }
  if (binding.segmentId.trim().length < 1 || binding.segmentId.trim().length > 160) {
    throw new Error('Invalid local node segment');
  }
  if (!validStatus(binding.status)) throw new Error('Invalid local node status');
  if (
    binding.credentialVersion !== undefined
    && (!Number.isInteger(binding.credentialVersion)
      || binding.credentialVersion < 1
      || binding.credentialVersion > 32_767)
  ) throw new Error('Invalid local credential version');
  if (!Number.isFinite(binding.updatedAtMs) || binding.updatedAtMs < 0) {
    throw new Error('Invalid local binding timestamp');
  }
}

function bindingFromEnroll(result: NodeControlNodeResult, nowMs: number): LocalNodeBinding {
  if (
    result.status !== 'provisioning'
    || result.label === undefined
    || result.segmentId === undefined
    || result.credentialStored !== true
  ) {
    throw new Error('Enrollment result is incomplete for local binding');
  }
  const binding: LocalNodeBinding = {
    schemaVersion: '1',
    nodeId: result.nodeId,
    label: result.label,
    segmentId: result.segmentId,
    status: result.status,
    ...(result.credentialVersion === undefined ? {} : { credentialVersion: result.credentialVersion }),
    updatedAtMs: nowMs,
  };
  validateLocalNodeBinding(binding);
  return binding;
}

/**
 * Coordinates human node-control calls with non-secret local device metadata.
 * The binding is a cache for restart/bootstrap; it never establishes server
 * authorization and never contains the raw sensor credential.
 */
export function createNodeProvisioningCoordinator(options: {
  control: NodeControlClient;
  store: NodeLocalBindingStore;
  nowMs?: () => number;
}): NodeProvisioningCoordinator {
  const nowMs = options.nowMs ?? Date.now;

  return {
    async current(): Promise<LocalNodeBinding | undefined> {
      const binding = await options.store.get();
      if (!binding) return undefined;
      validateLocalNodeBinding(binding);
      return binding;
    },

    async enroll(label: string, segmentId: string): Promise<LocalNodeBinding> {
      const result = await options.control.enroll(label, segmentId);
      const binding = bindingFromEnroll(result, nowMs());
      await options.store.put(binding);
      return binding;
    },

    async lifecycle(action: NodeLifecycleAction): Promise<LocalNodeBinding> {
      const existing = await options.store.get();
      if (!existing) throw new Error('This device is not bound to a Konta2r node');
      validateLocalNodeBinding(existing);
      const result = await options.control.lifecycle(existing.nodeId, action);
      if (result.nodeId !== existing.nodeId) throw new Error('Node lifecycle identity mismatch');
      const next: LocalNodeBinding = {
        ...existing,
        status: result.status,
        ...(result.credentialVersion === undefined
          ? {}
          : { credentialVersion: result.credentialVersion }),
        updatedAtMs: nowMs(),
      };
      validateLocalNodeBinding(next);
      await options.store.put(next);
      return next;
    },

    async clearLocalBinding(): Promise<void> {
      await options.store.clear();
    },
  };
}
