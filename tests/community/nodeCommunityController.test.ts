import { describe, expect, it } from 'vitest';
import type { HumanAuthClient, HumanAuthSnapshot } from '../../src/auth/supabaseBrowser';
import type { CommunitySender } from '../../src/community/outbox';
import {
  createNodeCommunityController,
  type NodeCommunityRuntime,
} from '../../src/community/nodeCommunityController';
import type {
  ActiveNodeCredential,
  LocalNodeIdentity,
  NodeProvisioner,
} from '../../src/community/nodeProvisioning';

function identity(status: LocalNodeIdentity['status'] = 'active'): LocalNodeIdentity {
  return {
    nodeId: 'node_01HZX5NQ7Y6F8V2G3K4M5P6R7S',
    label: 'ventana norte',
    segmentId: 'segment-alameda-001',
    status,
    ...(status === 'revoked' ? {} : { credential: 'k2n_v1_abcdefghijklmnopqrstuvwxyz1234567890ABCD' }),
    credentialVersion: 1,
    enrolledAtIso: '2026-09-01T00:00:00.000Z',
    updatedAtIso: '2026-09-01T00:00:00.000Z',
  };
}

function auth(initial: HumanAuthSnapshot): HumanAuthClient & { current: HumanAuthSnapshot } {
  const client: HumanAuthClient & { current: HumanAuthSnapshot } = {
    current: initial,
    async snapshot() {
      return client.current;
    },
    async accessToken() {
      return client.current.authenticated ? 'human-access-token' : undefined;
    },
    async signIn() {
      client.current = { authenticated: true, email: 'person@example.com' };
    },
    async signOut() {
      client.current = { authenticated: false };
    },
    subscribe() {
      return () => undefined;
    },
  };
  return client;
}

function provisioner(initial?: LocalNodeIdentity): NodeProvisioner & { current?: LocalNodeIdentity; provisionCalls: number } {
  const fake: NodeProvisioner & { current?: LocalNodeIdentity; provisionCalls: number } = {
    ...(initial ? { current: initial } : {}),
    provisionCalls: 0,
    async identity() {
      return fake.current;
    },
    async enroll(input) {
      const enrolled: LocalNodeIdentity = {
        ...identity('provisioning'),
        label: input.label,
        segmentId: input.segmentId,
      };
      fake.current = enrolled;
      return enrolled;
    },
    async provision(input) {
      fake.provisionCalls += 1;
      const active: LocalNodeIdentity = {
        ...identity('active'),
        label: input.label,
        segmentId: input.segmentId,
      };
      fake.current = active;
      return active;
    },
    async activate() {
      if (!fake.current) throw new Error('missing identity');
      fake.current = { ...fake.current, status: 'active' };
      return fake.current;
    },
    async pause() {
      if (!fake.current) throw new Error('missing identity');
      fake.current = { ...fake.current, status: 'paused' };
      return fake.current;
    },
    async rotate() {
      if (!fake.current) throw new Error('missing identity');
      fake.current = {
        ...fake.current,
        credential: 'k2n_v1_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890abcd',
        credentialVersion: fake.current.credentialVersion + 1,
      };
      return fake.current;
    },
    async revoke() {
      if (!fake.current) throw new Error('missing identity');
      const revoked: LocalNodeIdentity = {
        nodeId: fake.current.nodeId,
        label: fake.current.label,
        segmentId: fake.current.segmentId,
        status: 'revoked',
        credentialVersion: fake.current.credentialVersion,
        enrolledAtIso: fake.current.enrolledAtIso,
        updatedAtIso: fake.current.updatedAtIso,
      };
      fake.current = revoked;
      return revoked;
    },
    async activeCredential(): Promise<ActiveNodeCredential | undefined> {
      if (fake.current?.status !== 'active' || !fake.current.credential) return undefined;
      return {
        nodeId: fake.current.nodeId,
        credential: fake.current.credential,
        credentialVersion: fake.current.credentialVersion,
        segmentId: fake.current.segmentId,
      };
    },
    async clearRevoked() {
      if (fake.current?.status !== 'revoked') throw new Error('not revoked');
      delete fake.current;
    },
  };
  return fake;
}

async function refreshed(runtime: NodeCommunityRuntime): Promise<NodeCommunityRuntime> {
  await runtime.refresh();
  return runtime;
}

describe('node Community controller', () => {
  it('represents an unconfigured build without fabricating a node session', async () => {
    const runtime = createNodeCommunityController({ configured: false });
    await runtime.refresh();
    expect(runtime.snapshot()).toEqual({
      configured: false,
      human: { authenticated: false },
      sensorReady: false,
      busy: false,
    });
  });

  it('keeps the sensor ready after the temporary human session signs out', async () => {
    const human = auth({ authenticated: true, email: 'person@example.com' });
    const node = provisioner(identity('active'));
    const runtime = await refreshed(createNodeCommunityController({
      configured: true,
      auth: human,
      provisioner: node,
    }));

    expect(runtime.snapshot().sensorReady).toBe(true);
    await runtime.signOut();

    expect(runtime.snapshot().human.authenticated).toBe(false);
    expect(runtime.snapshot().identity?.status).toBe('active');
    expect(runtime.snapshot().sensorReady).toBe(true);
    expect(await runtime.activeCredential()).toBeDefined();
  });

  it('requires a human session before provisioning or lifecycle administration', async () => {
    const human = auth({ authenticated: false });
    const node = provisioner();
    const runtime = await refreshed(createNodeCommunityController({
      configured: true,
      auth: human,
      provisioner: node,
    }));

    await runtime.provision({ label: 'ventana', segmentId: 'segment-001' });

    expect(node.provisionCalls).toBe(0);
    expect(runtime.snapshot().error).toMatch(/sign in with google/i);
  });

  it('provisions an active node and redacts its sensor credential from UI state', async () => {
    const human = auth({ authenticated: true });
    const node = provisioner();
    const runtime = await refreshed(createNodeCommunityController({
      configured: true,
      auth: human,
      provisioner: node,
    }));

    await runtime.provision({ label: 'balcón', segmentId: 'segment-002' });
    const snapshot = runtime.snapshot();

    expect(snapshot.identity?.status).toBe('active');
    expect(snapshot.sensorReady).toBe(true);
    expect(snapshot.identity).toBeDefined();
    expect('credential' in (snapshot.identity ?? {})).toBe(false);
    expect(await runtime.activeCredential()).toBeDefined();
  });

  it('exposes the Community sender that is already bound to the provisioner credential provider', () => {
    const sender: CommunitySender = async () => ({ ok: true, retryable: false, statusCode: 202 });
    const runtime = createNodeCommunityController({ configured: false, sender });
    expect(runtime.sender()).toBe(sender);
  });
});
