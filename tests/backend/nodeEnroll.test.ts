import { describe, expect, it } from 'vitest';
import {
  enrollNodeForAuthenticatedUser,
  type NodeEnrollPersistenceInput,
  type NodeEnrollStore,
} from '../../src/backend/nodeEnroll';

const USER_ID = '123e4567-e89b-42d3-a456-426614174000';
const PEPPER = 'node-enroll-pepper-0123456789-abcdefghijklmnopqrstuvwxyz';

class MemoryEnrollStore implements NodeEnrollStore {
  readonly segments = new Set(['segment_cycleway_1']);
  persisted: NodeEnrollPersistenceInput | undefined;

  async segmentExists(segmentId: string): Promise<boolean> {
    return this.segments.has(segmentId);
  }

  async persistEnrollment(input: NodeEnrollPersistenceInput): Promise<void> {
    this.persisted = input;
  }
}

describe('node enrollment', () => {
  it('binds a generated sensor credential to the verified human owner without persisting the raw token', async () => {
    const store = new MemoryEnrollStore();
    const result = await enrollNodeForAuthenticatedUser(USER_ID, {
      label: '  Ventana norte  ',
      segmentId: ' segment_cycleway_1 ',
    }, {
      store,
      pepper: PEPPER,
      keyVersion: 3,
      randomFill: (bytes) => bytes.fill(23),
    });

    expect(result.nodeId).toMatch(/^node_/);
    expect(result.credential).toMatch(/^k2n_v1_/);
    expect(result.label).toBe('Ventana norte');
    expect(result.segmentId).toBe('segment_cycleway_1');
    expect(result.status).toBe('provisioning');
    expect(result.keyVersion).toBe(3);

    expect(store.persisted?.ownerUserId).toBe(USER_ID);
    expect(store.persisted?.credentialHmac).toMatch(/^[a-f0-9]{64}$/);
    expect(store.persisted).not.toHaveProperty('credential');
  });

  it('rejects owner identity that did not come from a verified Supabase user id', async () => {
    const store = new MemoryEnrollStore();
    await expect(enrollNodeForAuthenticatedUser('user-from-request-body', {
      label: 'Nodo',
      segmentId: 'segment_cycleway_1',
    }, { store, pepper: PEPPER })).rejects.toThrow('Verified owner');
    expect(store.persisted).toBeUndefined();
  });

  it('rejects unknown segments before generating or persisting a node', async () => {
    const store = new MemoryEnrollStore();
    await expect(enrollNodeForAuthenticatedUser(USER_ID, {
      label: 'Nodo',
      segmentId: 'segment_unknown',
    }, {
      store,
      pepper: PEPPER,
      randomFill: () => { throw new Error('random should not run'); },
    })).rejects.toThrow('does not exist');
    expect(store.persisted).toBeUndefined();
  });

  it('enforces database-compatible label and segment lengths', async () => {
    const store = new MemoryEnrollStore();
    await expect(enrollNodeForAuthenticatedUser(USER_ID, {
      label: '   ',
      segmentId: 'segment_cycleway_1',
    }, { store, pepper: PEPPER })).rejects.toThrow('1..120');

    await expect(enrollNodeForAuthenticatedUser(USER_ID, {
      label: 'Nodo',
      segmentId: 'x'.repeat(161),
    }, { store, pepper: PEPPER })).rejects.toThrow('1..160');
  });
});
