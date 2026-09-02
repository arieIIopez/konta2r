# Community bucket runtime

This layer connects the local semantic counting pipeline to Community delivery without persisting or uploading event-level mobility traces.

## Boundary

`EdgeMobilityPipeline` may produce local `LineCrossingEvent` objects containing ephemeral track/event/session identifiers and an exact crossing timestamp. Those objects are valid only inside the edge-processing boundary.

`CommunityFlowBucketCollector` immediately reduces matching crossings to:

- pseudonymous technical `nodeId`;
- coarse bucket start/end;
- mobility entity type;
- public direction;
- count;
- confidence sum.

The persistent `Konta2rCommunityBucketsDB` therefore contains no track ID, event ID, session ID, exact event timestamp, crossing coordinate, bounding box, frame or image.

The local counting `geometryId` is used only to select/group one stream. It is not present in `PublicFlowAggregate` and is not sent to the backend. The public location comes from the provisioned node `segmentId`.

## Node identity isolation

Every reduced bucket is bound to the pseudonymous `nodeId` that was active when the crossing was observed. The IndexedDB index is `(nodeId, streamId, bucketStartMs)`.

This is necessary because the same physical phone may later be revoked and provisioned as a new node or assigned to another public segment. A new identity must never inherit counts observed under an old identity.

The browser publisher obtains only the **redacted** active `nodeId` from `NodeCommunityRuntime.snapshot()`. It never receives the raw sensor credential. `CommunityDeliveryRuntime.enqueue()` also accepts `expectedNodeId`; if the active identity changes between bucket selection and enqueue, publication fails and the source bucket remains local instead of being attributed to the new node.

`Konta2rCommunityBucketsDB` version 2 deliberately discards version-1 buckets during migration because those older local counters did not carry node identity. Preserving them would create an attribution ambiguity, so privacy/data-integrity safety takes precedence over retaining those pre-release counters.

## Publication sequence

For each closed bucket of the currently active node:

1. low-count cells are suppressed according to the collector threshold;
2. an entirely suppressed bucket is deliberately committed locally without network publication;
3. a publishable bucket is converted to the strict Community protocol;
4. `CommunityDeliveryRuntime.enqueue()` receives a stable local-only publication key plus the expected source `nodeId`;
5. the sequence store reserves one sequence for `(nodeId, publicationKey)`;
6. the envelope is written durably to the outbox;
7. only after enqueue succeeds is the reduced source bucket deleted;
8. after source deletion, the temporary publication reservation is released;
9. the outbox is flushed using the sensor credential.

A crash between steps 6 and 7 leaves the source bucket and reservation behind. On restart, the same publication key resolves to the same sequence and therefore to the same outbox key (`nodeId:sequence`). The retry is idempotent instead of double-counting.

If the crash occurs after source deletion, the bucket cannot be republished; failure to release its reservation is only harmless local housekeeping and does not affect sequence monotonicity or the durable outbox.

## Persistence databases

- `Konta2rNodeIdentityDB`: local node identity and sensor credential;
- `Konta2rCommunityBucketsDB`: node-scoped, not-yet-published reduced flow counters;
- `Konta2rCommunitySequenceDB`: next sequence plus temporary publication reservations;
- `Konta2rCommunityDB`: envelopes waiting for acknowledged HTTP delivery.

These databases intentionally have separate lifecycles.

## Runtime and quality metadata

`runtimeTelemetry.ts` maps measurements already produced by `NodeRuntimeController`:

- observation uptime ratio;
- median inference cadence (`inferenceFpsP50`) computed from inter-inference intervals;
- inference latency p95;
- dropped-frame ratio;
- actual detector runtime backend.

The window-average `observedFps` remains available for adaptive runtime decisions, but it is not mislabeled as p50 in the Community protocol.

It does not claim browser-inaccessible metrics such as device temperature or battery health.

Until detector and tracker accuracy are independently calibrated on a representative corpus, crossing confidence is used as a conservative proxy for both detection and tracking quality. This is explicit in the `evidence` field and the resulting node quality remains `provisional` because ground-truth validation and network consistency are not yet available.

## Detector identity

`EdgeMobilityPipeline.getInitialization()` exposes detector initialization metadata without exposing frames. Publication uses the model SHA-256 when available; otherwise it falls back to the versioned adapter/model identity.

If detector metadata is not available, publishable closed buckets are retained rather than emitted with fabricated metadata.

## Operational wiring

Once a production detector/pipeline is selected, browser wiring is intentionally small:

```ts
const publisher = createBrowserCommunityFlowPublisher({
  community,
  runtime,
  pipeline,
  countingGeometryId: 'line_main',
  softwareVersion: '2.0.0-alpha.1',
  methodologyVersion: '2.0',
});

if (publisher) {
  const communityBridge = new RuntimeCommunityBridge(publisher);
  const inferenceBridge = new RuntimeInferenceBridge(runtime, pipeline, {
    onFrame: communityBridge.onFrame,
  });
}
```

`RuntimeCommunityBridge` also listens for browser `online` recovery and asks the publisher to retry both retained closed buckets and the durable outbox. Human Google/Supabase authentication is never used for this delivery path.

When the node is paused, revoked or otherwise inactive, new Community buckets are not collected and pending buckets are not reassigned. Reactivating the same node allows its own pending buckets to continue; provisioning a different node does not expose the old node's buckets.

## Remaining integration dependency

The main node UI does not yet instantiate a production detector. The Community bridge is therefore ready but should not be hard-wired to `NodePanel` until the detector/model selection milestone provides a real `EdgeMobilityPipeline` instance and counting-line configuration.
