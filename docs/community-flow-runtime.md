# Community flow runtime

## Scope

This document describes the browser/node path that turns local line-crossing events into durable Community flow aggregates.

It is an **implementation boundary**, not a claim of live deployment. The code can run only when the build has a valid Konta2r Community backend configuration and the phone has an active sensor node identity. A dedicated Konta2r Supabase project has not yet been deployed from this repository workflow.

## End-to-end boundary

The runtime path is:

```text
camera frame
  → detector / fusion / tracking
  → local LineCrossingEvent
  → CommunityFlowBucketCollector
  → aggregate-only IndexedDB bucket
  → CommunityFlowBucketPublisher
  → durable outbox + sequence reservation
  → ingest-community Edge Function
  → PostgreSQL Community batch + aggregate rows
```

Raw camera frames, detections, trajectories and event/track identifiers stop before the Community persistence boundary.

## Revision-scoped streams

A saved field geometry has:

- stable `configurationId`;
- monotonic `revision`;
- editor line id (`line_primary`).

The operational runtime derives:

```text
<configurationId>_r<revision>
```

Example:

```text
geometry_abc123_r4
```

This derived value becomes the runtime `geometryId`/local Community `streamId` for that revision.

Why: moving the line creates a different measurement geometry. Counts produced before and after that change must never share the same local privacy cell before low-count suppression or idempotent publication.

The editor configuration itself is not mutated; only the runtime clone receives the revision-scoped id.

## Active and retired streams

`BrowserCommunityFlowRuntime` owns a dynamic set of stream publishers.

Only the **active** geometry revision may ingest new `LineCrossingEvent`s.

A retired revision can remain in memory because it may still have a durable bucket whose five-minute window has not closed yet. It may therefore:

- finish its natural bucket lifetime;
- apply low-count suppression;
- enqueue an aggregate after the bucket closes;
- retry after connectivity returns.

It must never ingest crossings produced by a later geometry revision.

## Recovery after browser restart

`Konta2rCommunityBucketsDB` stores only reduced counters keyed by:

```text
nodeId + streamId + bucketStart + entityType + direction
```

`CommunityFlowBucketStore.listStreams(nodeId)` discovers revision streams that still have durable bucket cells.

On restart, the coordinator reconstructs publishers for those streams. This prevents an open bucket from becoming permanently stranded merely because the browser was closed or the PWA was restarted.

Recovery is strictly scoped to the **currently active node identity**. If the phone is reprovisioned, buckets belonging to an earlier `nodeId` are not re-attributed to the new identity.

## Immediate privacy reduction

`CommunityFlowBucketCollector.observe()` receives local `LineCrossingEvent`s but does not persist them.

For each accepted crossing it retains only:

- pseudonymous technical `nodeId`;
- revision-scoped local `streamId`;
- coarse bucket start/end;
- entity type;
- public direction (`A_TO_B`, `B_TO_A`, `UNSPECIFIED`);
- count;
- confidence sum used to derive mean quality.

It does **not** persist:

- `trackId`;
- `eventId`;
- local session id;
- exact event timestamp;
- crossing coordinate;
- bounding box;
- image/frame;
- face/plate/embedding;
- human authentication data;
- raw sensor credential.

The protocol validator additionally rejects privacy-sensitive field names recursively at the upload boundary.

## Time buckets and low-count suppression

Default flow settings are:

- bucket: 5 minutes;
- minimum event confidence: 0.5;
- minimum count per `(entityType, direction)` cell: 3.

A Community bucket can never be shorter than 60 seconds under the protocol.

Cells below `minCount` are suppressed locally and are never placed in the upload envelope. Once a closed bucket contains only suppressed cells it is explicitly committed/deleted without network publication.

A geometry revision inside a five-minute window can therefore create two local stream buckets with the same coarse wall-clock interval. Their event sets are disjoint. They remain separate through privacy suppression and local idempotency.

The current server schema stores each upload as a distinct `(nodeId, sequence)` batch, so one revision cannot overwrite another. Downstream analytics that combine batches for the same public segment/bucket must **sum counts** and compute any combined `meanQuality` weighted by each record's `count`; a simple average of per-batch means would be incorrect.

## Public segment versus local stream

These identifiers have different meanings:

- `streamId`: local measurement-geometry revision; used for bucket separation and publication idempotency;
- `observedSegment.segmentId`: public/logical segment assigned to the active sensor node during provisioning.

The current public flow record does not expose the local `streamId`. Backend batches remain distinct through node sequence identity. If future scientific auditing requires server-visible geometry revision lineage, that should be added as an explicit protocol field rather than overloading `observedSegment.sourceVersion`.

## Crash-idempotent publication

For each closed source bucket the publisher derives a stable local publication key:

```text
flow-v2:<nodeId>:<streamId>:<bucketStart>:<bucketEnd>
```

The sequence store reserves a sequence for that key before durable outbox enqueue.

Order of operations:

1. create aggregate-only draft;
2. reserve/reuse sequence;
3. durably enqueue Community envelope;
4. delete source bucket;
5. release the temporary publication reservation;
6. attempt network flush.

A crash between steps 3 and 4 repeats the same publication key/sequence rather than creating a second logical batch.

Backend persistence independently enforces unique `(nodeId, sequence)` and compares payload hashes to distinguish a legitimate retry from an idempotency conflict.

## Connectivity and node lifecycle

When connectivity returns, the coordinator retries every publisher associated with durable streams for the current node.

If the sensor node is inactive, paused, revoked or missing:

- no new Community bucket is attributed;
- pending aggregate state remains local;
- the delivery path does not fall back to the human Google/Supabase session;
- no pending bucket from one `nodeId` is reassigned to another.

Human authentication exists only for node administration. Long-running delivery uses the dedicated `Konta2rNode` credential.

## UI behavior

The Node panel separates:

- **Cruces locales** — immediate in-memory A→B/B→A crossing count;
- **Community flujo** — aggregate/bucket delivery state.

A Community failure does not stop camera capture, inference, tracking or local counting. The UI reports the Community error while durable bucket/outbox data remains available for retry.

## Current validation boundary

Implemented/tests cover:

- aggregate-only collector behavior;
- low-count suppression;
- node identity isolation;
- crash-idempotent bucket → outbox publication;
- inactive-node delivery behavior;
- revision-scoped stream ids;
- only-active-stream event ingestion;
- retired-stream maintenance;
- pending-stream recovery after restart;
- node-identity changes creating a fresh publisher set;
- connectivity-restored retry across recovered streams.

Still required before claiming a deployed Community network:

1. deploy a dedicated Konta2r Supabase project;
2. apply/verify schema and Edge Functions there;
3. configure browser publishable key/project URL;
4. provision a real test node/segment;
5. run E2E offline/online field tests;
6. verify database rows and idempotent retries against the live backend;
7. validate public retention/governance rules and downstream aggregate queries.
