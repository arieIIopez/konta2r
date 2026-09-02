import type { CommunityDeliveryRuntime } from './deliveryRuntime';
import type { CommunitySender } from './outbox';
import type { ActiveNodeCredential, LocalNodeIdentity, NodeProvisioner } from './nodeProvisioning';
import type { HumanAuthClient, HumanAuthSnapshot } from '../auth/supabaseBrowser';

export interface NodeCommunityIdentity {
  nodeId: string;
  label: string;
  segmentId: string;
  status: LocalNodeIdentity['status'];
  credentialVersion: number;
  enrolledAtIso: string;
  updatedAtIso: string;
}

export interface NodeCommunitySnapshot {
  configured: boolean;
  human: HumanAuthSnapshot;
  identity?: NodeCommunityIdentity;
  sensorReady: boolean;
  busy: boolean;
  error?: string;
}

export interface NodeCommunityControllerOptions {
  configured: boolean;
  auth?: HumanAuthClient;
  provisioner?: NodeProvisioner;
  sender?: CommunitySender;
  delivery?: CommunityDeliveryRuntime;
}

export interface NodeCommunityRuntime {
  subscribe(listener: (snapshot: NodeCommunitySnapshot) => void): () => void;
  snapshot(): NodeCommunitySnapshot;
  refresh(): Promise<void>;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  provision(input: { label: string; segmentId: string }): Promise<void>;
  activate(): Promise<void>;
  pause(): Promise<void>;
  rotate(): Promise<void>;
  revoke(): Promise<void>;
  clearRevoked(): Promise<void>;
  activeCredential(): Promise<ActiveNodeCredential | undefined>;
  sender(): CommunitySender | undefined;
  delivery(): CommunityDeliveryRuntime | undefined;
  destroy(): void;
}

const EMPTY_HUMAN: HumanAuthSnapshot = { authenticated: false };

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function redactIdentity(identity: LocalNodeIdentity): NodeCommunityIdentity {
  return {
    nodeId: identity.nodeId,
    label: identity.label,
    segmentId: identity.segmentId,
    status: identity.status,
    credentialVersion: identity.credentialVersion,
    enrolledAtIso: identity.enrolledAtIso,
    updatedAtIso: identity.updatedAtIso,
  };
}

export function createNodeCommunityController(options: NodeCommunityControllerOptions): NodeCommunityRuntime {
  const listeners = new Set<(snapshot: NodeCommunitySnapshot) => void>();
  let state: NodeCommunitySnapshot = {
    configured: options.configured,
    human: EMPTY_HUMAN,
    sensorReady: false,
    busy: false,
  };

  function emit(): void {
    for (const listener of listeners) listener(state);
  }

  function replace(next: NodeCommunitySnapshot): void {
    state = next;
    emit();
  }

  function setError(error: unknown): void {
    replace({ ...state, busy: false, error: message(error) });
  }

  function setBusy(): void {
    const next = { ...state, busy: true };
    delete next.error;
    replace(next);
  }

  function clearBusy(): void {
    const next = { ...state, busy: false };
    delete next.error;
    replace(next);
  }

  async function load(): Promise<void> {
    if (!options.configured || !options.auth || !options.provisioner) {
      const next: NodeCommunitySnapshot = {
        configured: false,
        human: EMPTY_HUMAN,
        sensorReady: false,
        busy: state.busy,
      };
      if (state.error) next.error = state.error;
      replace(next);
      return;
    }
    const [human, identity, credential] = await Promise.all([
      options.auth.snapshot(),
      options.provisioner.identity(),
      options.provisioner.activeCredential(),
    ]);
    const next: NodeCommunitySnapshot = {
      configured: true,
      human,
      sensorReady: credential !== undefined,
      busy: state.busy,
    };
    if (identity) next.identity = redactIdentity(identity);
    if (state.error) next.error = state.error;
    replace(next);
  }

  async function action(operation: () => Promise<void>): Promise<void> {
    if (state.busy) return;
    setBusy();
    try {
      await operation();
      await load();
      clearBusy();
    } catch (error) {
      setError(error);
    }
  }

  function requireConfigured(): { auth: HumanAuthClient; provisioner: NodeProvisioner } {
    if (!options.configured || !options.auth || !options.provisioner) {
      throw new Error('Community mode is not configured on this build');
    }
    return { auth: options.auth, provisioner: options.provisioner };
  }

  function requireHuman(): { auth: HumanAuthClient; provisioner: NodeProvisioner } {
    const dependencies = requireConfigured();
    if (!state.human.authenticated) {
      throw new Error('Sign in with Google to administer this node');
    }
    return dependencies;
  }

  const unsubscribeAuth = options.auth?.subscribe(() => {
    void load().catch(setError);
  });

  return {
    subscribe(listener): () => void {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },

    snapshot: () => state,

    async refresh(): Promise<void> {
      await action(load);
    },

    async signIn(): Promise<void> {
      await action(async () => {
        const { auth } = requireConfigured();
        await auth.signIn();
      });
    },

    async signOut(): Promise<void> {
      await action(async () => {
        const { auth } = requireConfigured();
        await auth.signOut();
      });
    },

    async provision(input): Promise<void> {
      await action(async () => {
        const { provisioner } = requireHuman();
        await provisioner.provision(input);
      });
    },

    async activate(): Promise<void> {
      await action(async () => {
        const { provisioner } = requireHuman();
        await provisioner.activate();
      });
    },

    async pause(): Promise<void> {
      await action(async () => {
        const { provisioner } = requireHuman();
        await provisioner.pause();
      });
    },

    async rotate(): Promise<void> {
      await action(async () => {
        const { provisioner } = requireHuman();
        await provisioner.rotate();
      });
    },

    async revoke(): Promise<void> {
      await action(async () => {
        const { provisioner } = requireHuman();
        await provisioner.revoke();
      });
    },

    async clearRevoked(): Promise<void> {
      await action(async () => {
        const { provisioner } = requireConfigured();
        await provisioner.clearRevoked();
      });
    },

    async activeCredential(): Promise<ActiveNodeCredential | undefined> {
      if (!options.configured || !options.provisioner) return undefined;
      return options.provisioner.activeCredential();
    },

    sender: () => options.sender,
    delivery: () => options.delivery,

    destroy(): void {
      unsubscribeAuth?.();
      listeners.clear();
    },
  };
}
