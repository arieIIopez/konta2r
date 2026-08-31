import type { NodeCredentialVault } from '../backend/nodeCredentialVault.ts';
import type {
  LocalNodeBinding,
  NodeLocalBindingStore,
} from '../backend/nodeLocalBinding.ts';
import type { CommunityOutboxStore } from '../community/outbox.ts';

export type NodeCommunityReadiness =
  | 'unbound'
  | 'provisioning'
  | 'paused'
  | 'credential_missing'
  | 'revoked'
  | 'ready';

export interface NodeOperationalStatusSnapshot {
  readiness: NodeCommunityReadiness;
  binding?: LocalNodeBinding;
  credentialAvailable: boolean;
  pending: number;
  deadLetter: number;
  /** False/true is only local readiness. Backend state is re-validated on ingest. */
  locallyReadyForCommunity: boolean;
}

export interface NodeOperationalStatusSource {
  snapshot(): Promise<NodeOperationalStatusSnapshot>;
}

export interface NodeOperationalStatusDependencies {
  bindingStore: NodeLocalBindingStore;
  vault: NodeCredentialVault;
  outbox: CommunityOutboxStore;
}

function readinessFor(
  binding: LocalNodeBinding | undefined,
  credentialAvailable: boolean,
): NodeCommunityReadiness {
  if (!binding) return 'unbound';
  if (binding.status === 'revoked') return 'revoked';
  if (!credentialAvailable) return 'credential_missing';
  if (binding.status === 'provisioning') return 'provisioning';
  if (binding.status === 'paused') return 'paused';
  return 'ready';
}

/**
 * Produces a secret-free local readiness view. `ready` means only that this
 * browser has an active-looking cached binding plus usable local credential.
 * ingest-community remains authoritative and re-checks node state server-side.
 */
export function createNodeOperationalStatusSource(
  dependencies: NodeOperationalStatusDependencies,
): NodeOperationalStatusSource {
  return {
    async snapshot(): Promise<NodeOperationalStatusSnapshot> {
      const binding = await dependencies.bindingStore.get();
      const [credentialAvailable, pending, deadLetter] = await Promise.all([
        binding ? dependencies.vault.has(binding.nodeId) : Promise.resolve(false),
        dependencies.outbox.count('pending'),
        dependencies.outbox.count('dead_letter'),
      ]);
      const readiness = readinessFor(binding, credentialAvailable);
      return {
        readiness,
        ...(binding === undefined ? {} : { binding }),
        credentialAvailable,
        pending,
        deadLetter,
        locallyReadyForCommunity: readiness === 'ready',
      };
    },
  };
}
