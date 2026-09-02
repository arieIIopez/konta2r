# Counting geometry on the node

## Purpose

Konta2r must not produce Community flow aggregates until the operator has defined a real counting geometry for the camera view.

The first field geometry is one finite, oriented line. It is stored in normalized source-frame coordinates, drives the local semantic counting runtime and now also defines the revision-scoped stream used by the privacy-preserving Community bucket layer.

This is a code-level integration. It does **not** mean that a live Konta2r Supabase backend has been deployed.

## Touch editor

The node UI overlays a touch/pointer editor on the live camera.

Workflow:

1. start the camera;
2. choose `Definir línea`;
3. drag from one endpoint to the other;
4. inspect the arrow and side labels `A` / `B`;
5. save;
6. edit again to create a new revision, or clear the geometry.

A line shorter than 4% of the normalized frame coordinate scale is rejected as too short for reliable touch editing.

While the operator is editing, the saved line is removed from the operational counting pipeline. This prevents the runtime from silently counting with an old geometry hidden behind a moving draft.

## `object-fit: cover` mapping

The Node camera uses CSS `object-fit: cover`.

The visible element can therefore crop the source frame. Screen pointer coordinates cannot safely be normalized as `x / elementWidth`, `y / elementHeight`.

`countingGeometry.ts` explicitly reconstructs the centered cover transform:

- scale = `max(viewportWidth/sourceWidth, viewportHeight/sourceHeight)`;
- rendered source dimensions are derived from that scale;
- horizontal/vertical crop offsets are removed;
- the resulting source-frame point is normalized to `[0,1]`.

The inverse mapping is used to draw saved normalized geometry back onto the cropped viewport.

Tests cover crop and round-trip behavior.

## Direction convention

The line itself is oriented from endpoint `a` to endpoint `b`; the arrow in the UI shows that reference orientation.

The two **crossing sides** are separate from the line endpoints:

- side `A` = positive signed side of the oriented line (`LEFT` in the geometry engine convention);
- side `B` = negative signed side (`RIGHT`);
- crossing `A → B` = `LEFT_TO_RIGHT`;
- crossing `B → A` = `RIGHT_TO_LEFT`.

The Community collector maps those directions to `A_TO_B` / `B_TO_A`.

The labels describe transversal movement across the line, not travel along the arrow.

## Versioned configuration

`CountingGeometryConfiguration` schema `1.0` stores:

- stable `configurationId`;
- monotonic local `revision`;
- `updatedAtIso`;
- reference camera width/height/aspect ratio;
- normalized directed line;
- explicit direction convention.

Editing an existing geometry preserves `configurationId` and increments `revision`.

The reference frame does not convert normalized geometry back into pixels. It is retained as audit evidence of the camera framing under which that revision was defined.

### Revision-scoped operational stream

The persisted editor line keeps the stable id `line_primary`, but the operational clone receives:

```text
<configurationId>_r<revision>
```

For example:

```text
geometry_abcd1234_r3
```

That id becomes both the local crossing `geometryId` and the Community bucket `streamId` for that revision.

This prevents counts produced under two different physical line placements from being combined in the same local privacy cell before low-count suppression or idempotent publication.

## Runtime activation boundary

The saved geometry is connected to `NanoDetPilotPipeline` and `EdgeMobilityPipeline`.

`EdgeMobilityPipeline.setCountingLines()` is the only runtime replacement boundary. It:

1. clones the incoming normalized geometry;
2. resets the multi-object tracker;
3. resets line-crossing hysteresis/pending events;
4. creates a new `TrackCountingEngine`, or disables counting for an empty list.

This ordering is intentional. A trajectory observed under revision N must never be completed against revision N+1.

The same reset boundary is used when:

- a saved geometry revision is applied;
- the line is removed;
- the operator enters edit mode, which temporarily disables counting;
- a new node run starts;
- the capture performance profile/resolution changes.

NanoDet accepts geometry before lazy model initialization. The latest geometry is reapplied after initialization so a line changed while the external model is loading cannot be lost.

## Local crossing counters

The Node panel displays **Cruces locales**:

- total crossings in the current local counting epoch;
- `A→B` count;
- `B→A` count;
- active geometry revision.

These UI counters are deliberately ephemeral and local. They reset when a new counting epoch starts.

Individual `LineCrossingEvent`s contain track/event identifiers internally because they are local semantic events. Those identifiers stop at the Community collector boundary and are never part of Community bucket persistence or upload envelopes.

## Community aggregation

When Community is configured and an active sensor node exists, the same local crossings feed `CommunityFlowBucketCollector`.

The collector immediately reduces them to coarse counters by:

- node identity;
- revision-scoped stream;
- five-minute bucket by default;
- entity type;
- public A/B direction;
- count and confidence sum.

It never persists event ids, track ids, exact crossing timestamps, coordinates, boxes or images.

Low-count cells are suppressed before upload (`minCount = 3` by default). The bucket layer supports offline persistence, crash-idempotent outbox enqueue and recovery of retired geometry streams after browser restart.

See `docs/community-flow-runtime.md` for the complete lifecycle.

## Persistence and privacy

Geometry database:

- `Konta2rCountingGeometryDB`;
- store: `geometry`;
- key: `current`.

Only geometry/configuration metadata is persisted there.

Community flow bucket storage is separate and contains reduced counters only. Neither store contains:

- image or video frame;
- raw detection;
- bounding box;
- track identifier;
- exact crossing point;
- human authentication token;
- raw sensor credential.

## Validation coverage

Tests verify that:

- counting can be enabled after the pipeline is already running;
- an empty geometry list disables counting;
- replacing geometry resets tracker/event history before the next frame;
- caller mutation cannot alter the active cloned line;
- geometry supplied to NanoDet before lazy initialization is actually used;
- the public `resetTrackingAndEvents()` boundary starts a clean trajectory epoch;
- every saved geometry revision receives a distinct operational stream id;
- the editor's persisted line id is not mutated by runtime stream derivation;
- only the active stream ingests new Community crossings;
- retired streams remain only to finish/retry durable buckets;
- pending streams can be recovered after browser restart.

## Remaining external gate

The geometry-to-Community path is implemented in code. What remains before claiming a functioning distributed Community network is operational validation against a **dedicated Konta2r backend**:

1. deploy the Konta2r Supabase project;
2. apply schema/Edge Functions;
3. provision real nodes and segments;
4. run offline/online E2E tests on phones;
5. verify aggregate rows, retry/idempotency and suppression in the live database;
6. validate downstream dashboard aggregation and governance/retention policy.
