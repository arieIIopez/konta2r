import { describe, expect, it } from 'vitest';
import type { DetectorInitialization } from '../../src/detection/types';
import type { NodeRuntimeSnapshot } from '../../src/node/runtimeController';
import type { CommunityDeliveryRuntime } from '../../src/community/deliveryRuntime';
import type { ClosedCommunityFlowBucket } from '../../src/community/flowBucketCollector';
import { CommunityFlowBucketPublisher } from '../../src/community/flowBucketPublisher';

const NODE_A = 'node_publish01';
const NODE_B = 'node_publish02';

function detector(): DetectorInitialization {
  return {
    model: {
      adapterId: 'test-adapter',
      modelId: 'test-model',
      modelVersion: '1',
      modelSha256: 'deadbeef',
      weightsRedistributionVerified: true,
      inputWidth: 320,
      inputHeight: 320,
      classNames: ['person'],
    },
    runtime: {
      runtime: 'onnxruntime-web',
      backend: 'wasm',
      executionProviders: ['wasm'],
    },
  };
}

function snapshot(): NodeRuntimeSnapshot {
  return {
    running: true,
    busy: false,
    profile: 'balanced',
    hints: {},
    camera: { active: true },
    wakeLock: { supported: true, active: true },
    storage: null,
    health: {
      sampleCount: 30,
      observedFps: 5,
      inferenceFpsP50: 4.9,
      processingLatencyP95Ms: 180,
      droppedFrameRatio: 0.05,
      loadPressure: 'nominal',
      latencyDriftRatio: 0,
    },
    continuity: {
      state: 'active',
      elapsedMs: 300_000,
      activeMs: 294_000,
      uptimeRatio: 0.98,
      gapCount: 0,
      longestGapMs: 0,
    },
    online: true,
    secureContext: true,
  } as NodeRuntimeSnapshot;
}

function bucket(nodeId = NODE_A, records = true): ClosedCommunityFlowBucket {
  return {
    nodeId,
    streamId: 'line_main',
    bucketStartMs: 1_788_000_000_000,
    bucketEndMs: 1_788_000_300_000,
    suppressedCount: records ? 0 : 2,
    records: records ? [{
      schemaVersion: '2.0',
      aggregateType: 'flow',
      bucketStartMs: 1_788_000_000_000,
      bucketEndMs: 1_788_000_300_000,
      entityType: 'pedestrian',
      direction: 'A_TO_B',
      count: 8,
      meanQuality: 0.87,
    }] : [],
  };
}

function deliveryHarness() {
  const publicationKeys: string[] = [];
  const expectedNodeIds: Array<string | undefined> = [];
  const releasedKeys: string[] = [];
  let flushes = 0;
  const delivery = {
    async enqueue(
      _draft: unknown,
      options?: { publicationKey?: string; expectedNodeId?: string },
    ) {
      publicationKeys.push(options?.publicationKey ?? '');
      expectedNodeIds.push(options?.expectedNodeId);
      return { nodeId: options?.expectedNodeId ?? NODE_A };
    },
    async releasePublication(nodeId: string, publicationKey: string) {
      releasedKeys.push(`${nodeId}|${publicationKey}`);
    },
    async flush() {
      flushes += 1;
      return { attempted: 0, delivered: 0, retryScheduled: 0, deadLettered: 0 };
    },
  } as unknown as CommunityDeliveryRuntime;
  return {
    delivery,
    publicationKeys,
    expectedNodeIds,
    releasedKeys,
    flushes: () => flushes,
  };
}

describe('CommunityFlowBucketPublisher', () => {
  it('enqueues a closed public bucket, commits its source and retires the reservation', async () => {
    const commits: Array<[string, number]> = [];
    const harness = deliveryHarness();
    const publisher = new CommunityFlowBucketPublisher({
      collector: {
        async observe() {},
        async closed(nodeId) { return [bucket(nodeId)]; },
        async commit(nodeId, start) { commits.push([nodeId, start]); },
      },
      delivery: harness.delivery,
      activeNodeId: () => NODE_A,
      runtimeSnapshot: snapshot,
      detectorInitialization: detector,
      softwareVersion: '2.0.0-alpha.1',
      methodologyVersion: '2.0',
    });

    const result = await publisher.publishClosed(1_788_000_400_000);
    expect(result.enqueuedBuckets).toBe(1);
    expect(commits).toEqual([[NODE_A, 1_788_000_000_000]]);
    expect(harness.publicationKeys).toEqual([
      'flow-v2:node_publish01:line_main:1788000000000:1788000300000',
    ]);
    expect(harness.expectedNodeIds).toEqual([NODE_A]);
    expect(harness.releasedKeys).toEqual([
      'node_publish01|flow-v2:node_publish01:line_main:1788000000000:1788000300000',
    ]);
  });

  it('reuses the same publication key when a crash-like commit failure leaves the bucket behind', async () => {
    let commits = 0;
    const harness = deliveryHarness();
    const publisher = new CommunityFlowBucketPublisher({
      collector: {
        async observe() {},
        async closed(nodeId) { return [bucket(nodeId)]; },
        async commit() {
          commits += 1;
          if (commits === 1) throw new Error('simulated crash boundary');
        },
      },
      delivery: harness.delivery,
      activeNodeId: () => NODE_A,
      runtimeSnapshot: snapshot,
      detectorInitialization: detector,
      softwareVersion: '2.0.0-alpha.1',
      methodologyVersion: '2.0',
    });

    const first = await publisher.publishClosed(1_788_000_400_000);
    const second = await publisher.publishClosed(1_788_000_401_000);
    expect(first.skipped).toBe('enqueue_unavailable');
    expect(second.enqueuedBuckets).toBe(1);
    expect(harness.publicationKeys).toHaveLength(2);
    expect(harness.publicationKeys[0]).toBe(harness.publicationKeys[1]);
    expect(harness.releasedKeys).toHaveLength(1);
  });

  it('retains publishable buckets until detector metadata exists', async () => {
    const harness = deliveryHarness();
    let committed = false;
    const publisher = new CommunityFlowBucketPublisher({
      collector: {
        async observe() {},
        async closed(nodeId) { return [bucket(nodeId)]; },
        async commit() { committed = true; },
      },
      delivery: harness.delivery,
      activeNodeId: () => NODE_A,
      runtimeSnapshot: snapshot,
      detectorInitialization: () => null,
      softwareVersion: '2.0.0-alpha.1',
      methodologyVersion: '2.0',
    });

    const result = await publisher.publishClosed(1_788_000_400_000);
    expect(result.skipped).toBe('model_unavailable');
    expect(result.retainedBuckets).toBe(1);
    expect(committed).toBe(false);
    expect(harness.publicationKeys).toHaveLength(0);
  });

  it('commits deliberately suppressed low-count buckets without uploading them', async () => {
    const harness = deliveryHarness();
    let committed = false;
    const publisher = new CommunityFlowBucketPublisher({
      collector: {
        async observe() {},
        async closed(nodeId) { return [bucket(nodeId, false)]; },
        async commit() { committed = true; },
      },
      delivery: harness.delivery,
      activeNodeId: () => NODE_A,
      runtimeSnapshot: snapshot,
      detectorInitialization: detector,
      softwareVersion: '2.0.0-alpha.1',
      methodologyVersion: '2.0',
    });

    const result = await publisher.publishClosed(1_788_000_400_000);
    expect(result.suppressedBuckets).toBe(1);
    expect(committed).toBe(true);
    expect(harness.publicationKeys).toHaveLength(0);
  });

  it('does not inspect or publish buckets while the node is inactive', async () => {
    const harness = deliveryHarness();
    let closedCalls = 0;
    const publisher = new CommunityFlowBucketPublisher({
      collector: {
        async observe() {},
        async closed() {
          closedCalls += 1;
          return [bucket(NODE_A)];
        },
        async commit() {},
      },
      delivery: harness.delivery,
      activeNodeId: () => undefined,
      runtimeSnapshot: snapshot,
      detectorInitialization: detector,
      softwareVersion: '2.0.0-alpha.1',
      methodologyVersion: '2.0',
    });

    const result = await publisher.publishClosed(1_788_000_400_000);
    expect(result.skipped).toBe('node_inactive');
    expect(closedCalls).toBe(0);
    expect(harness.publicationKeys).toHaveLength(0);
    expect(harness.flushes()).toBe(1);
  });

  it('never accepts a bucket claiming another node from a custom collector', async () => {
    const harness = deliveryHarness();
    let committed = false;
    const publisher = new CommunityFlowBucketPublisher({
      collector: {
        async observe() {},
        async closed() { return [bucket(NODE_B)]; },
        async commit() { committed = true; },
      },
      delivery: harness.delivery,
      activeNodeId: () => NODE_A,
      runtimeSnapshot: snapshot,
      detectorInitialization: detector,
      softwareVersion: '2.0.0-alpha.1',
      methodologyVersion: '2.0',
    });

    const result = await publisher.publishClosed(1_788_000_400_000);
    expect(result.retainedBuckets).toBe(1);
    expect(result.enqueuedBuckets).toBe(0);
    expect(committed).toBe(false);
    expect(harness.publicationKeys).toHaveLength(0);
  });

  it('uses connectivity recovery to flush an existing durable outbox even with no closed bucket', async () => {
    const harness = deliveryHarness();
    const publisher = new CommunityFlowBucketPublisher({
      collector: {
        async observe() {},
        async closed() { return []; },
        async commit() {},
      },
      delivery: harness.delivery,
      activeNodeId: () => NODE_A,
      runtimeSnapshot: snapshot,
      detectorInitialization: detector,
      softwareVersion: '2.0.0-alpha.1',
      methodologyVersion: '2.0',
    });

    await publisher.connectivityRestored(1_788_000_400_000);
    expect(harness.flushes()).toBe(1);
  });
});
