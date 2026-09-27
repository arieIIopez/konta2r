import { describe, expect, it } from 'vitest';
import type { EdgeMobilityPipelineFrame } from '../../src/pipeline/edgeMobilityPipeline';
import {
  BrowserCommunityFlowRuntime,
  type CommunityFlowPublisherPort,
} from '../../src/community/flowRuntime';

const NODE_A = 'node_flow001';
const NODE_B = 'node_flow002';
const frame = {} as EdgeMobilityPipelineFrame;

function publishResult() {
  return {
    closedBuckets: 0,
    enqueuedBuckets: 0,
    suppressedBuckets: 0,
    retainedBuckets: 0,
    flush: { attempted: 0, delivered: 0, retryScheduled: 0, deadLettered: 0 },
  };
}

class FakePublisher implements CommunityFlowPublisherPort {
  readonly observed: Array<{ frame: EdgeMobilityPipelineFrame; at?: number }> = [];
  readonly published: number[] = [];
  readonly restored: number[] = [];

  async observeFrame(input: EdgeMobilityPipelineFrame, observedAtEpochMs?: number): Promise<void> {
    this.observed.push({ frame: input, ...(observedAtEpochMs === undefined ? {} : { at: observedAtEpochMs }) });
  }

  async publishClosed(nowEpochMs?: number) {
    this.published.push(nowEpochMs ?? -1);
    return publishResult();
  }

  async connectivityRestored(nowEpochMs?: number) {
    this.restored.push(nowEpochMs ?? -1);
    return publishResult();
  }
}

function harness(initialNode: string | null = NODE_A) {
  let nodeId: string | undefined = initialNode ?? undefined;
  const pendingByNode = new Map<string, string[]>();
  const created = new Map<string, FakePublisher[]>();
  const runtime = new BrowserCommunityFlowRuntime({
    activeNodeId: () => nodeId,
    publisherFactory: (streamId) => {
      const publisher = new FakePublisher();
      const list = created.get(streamId) ?? [];
      list.push(publisher);
      created.set(streamId, list);
      return publisher;
    },
    pendingStreams: {
      async listStreams(node) {
        return [...(pendingByNode.get(node) ?? [])];
      },
    },
    maintenanceIntervalMs: 1_000,
    nowMs: () => 10_000,
  });
  return {
    runtime,
    created,
    pendingByNode,
    setNode(value: string | undefined) { nodeId = value; },
    latest(streamId: string): FakePublisher | undefined {
      return created.get(streamId)?.at(-1);
    },
  };
}

describe('BrowserCommunityFlowRuntime', () => {
  it('sends new frames only to the active revision and maintains retired pending streams', async () => {
    const h = harness();
    await h.runtime.setActiveStream('geometry_abc123_r1');
    await h.runtime.observeFrame(frame, 2_000);
    expect(h.latest('geometry_abc123_r1')?.observed).toHaveLength(1);

    h.pendingByNode.set(NODE_A, ['geometry_abc123_r1']);
    await h.runtime.setActiveStream('geometry_abc123_r2');
    await h.runtime.observeFrame(frame, 4_000);

    expect(h.latest('geometry_abc123_r1')?.observed).toHaveLength(1);
    expect(h.latest('geometry_abc123_r1')?.published).toEqual([4_000]);
    expect(h.latest('geometry_abc123_r2')?.observed).toHaveLength(1);
    expect(h.runtime.snapshot().trackedStreamIds).toEqual([
      'geometry_abc123_r1',
      'geometry_abc123_r2',
    ]);
  });

  it('recovers a retired stream after restart and removes it after durable bucket state disappears', async () => {
    const h = harness();
    h.pendingByNode.set(NODE_A, ['geometry_old123_r3']);

    await h.runtime.publishClosed(20_000);
    expect(h.latest('geometry_old123_r3')?.published).toEqual([20_000]);
    expect(h.runtime.snapshot().pendingRecovered).toBe(1);

    h.pendingByNode.set(NODE_A, []);
    await h.runtime.publishClosed(21_000);
    expect(h.runtime.snapshot().trackedStreamIds).toEqual([]);
  });

  it('never reuses publisher instances across node identity changes', async () => {
    const h = harness(NODE_A);
    await h.runtime.setActiveStream('geometry_same01_r1');
    await h.runtime.observeFrame(frame, 1_000);
    const nodeAPublisher = h.latest('geometry_same01_r1');

    h.setNode(NODE_B);
    await h.runtime.observeFrame(frame, 2_000);
    const nodeBPublisher = h.latest('geometry_same01_r1');

    expect(nodeAPublisher).toBeDefined();
    expect(nodeBPublisher).toBeDefined();
    expect(nodeBPublisher).not.toBe(nodeAPublisher);
    expect(h.created.get('geometry_same01_r1')).toHaveLength(2);
    expect(h.runtime.snapshot().nodeId).toBe(NODE_B);
  });

  it('does not recover or attribute flow when there is no active sensor node', async () => {
    const h = harness(null);
    h.pendingByNode.set(NODE_A, ['geometry_pending1_r1']);
    await h.runtime.setActiveStream('geometry_live001_r1');
    await h.runtime.observeFrame(frame, 5_000);
    await h.runtime.publishClosed(6_000);

    expect(h.created.size).toBe(0);
    expect(h.runtime.snapshot().trackedStreamIds).toEqual([]);
    expect(h.runtime.snapshot().nodeId).toBeUndefined();
  });

  it('retries every recovered current-node stream when connectivity returns', async () => {
    const h = harness();
    h.pendingByNode.set(NODE_A, ['geometry_retire1_r1']);
    await h.runtime.setActiveStream('geometry_active1_r2');
    await h.runtime.connectivityRestored(30_000);

    expect(h.latest('geometry_active1_r2')?.restored).toEqual([30_000]);
    expect(h.latest('geometry_retire1_r1')?.restored).toEqual([30_000]);
  });
});
