# Counting geometry on the node

## Purpose

Konta2r must not publish flow counts until the operator has defined a real counting geometry for the camera view.

The first field geometry is one finite, oriented line. It is stored in normalized source-frame coordinates and is now connected to the local semantic counting runtime.

Saving a line **does not** enable Community publication. The current runtime milestone ends at local `LineCrossingEvent`s and local A→B / B→A counters. Community aggregation remains a separate privacy boundary.

## Touch editor

The node UI overlays a touch/pointer editor on the live camera.

Workflow:

1. start the camera;
2. choose `Definir línea`;
3. drag from one endpoint to the other;
4. inspect the arrow and side labels `A` / `B`;
5. save;
6. edit again to create a new revision, or clear the geometry.

A line shorter than 4% of the normalized frame diagonal coordinate scale is rejected as too short for reliable touch editing.

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

- side `A` = positive signed side of the oriented line (`LEFT` in the current geometry engine convention);
- side `B` = negative signed side (`RIGHT`);
- crossing `A → B` = `LEFT_TO_RIGHT`;
- crossing `B → A` = `RIGHT_TO_LEFT`.

The public Community protocol already maps these to `A_TO_B` / `B_TO_A`.

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

## Runtime activation boundary

The saved geometry is now connected to `NanoDetPilotPipeline` and `EdgeMobilityPipeline`.

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

The Node panel now displays an in-memory field named **Cruces locales**.

It shows:

- total crossings in the current local counting epoch;
- `A→B` count;
- `B→A` count;
- active geometry revision.

These counters are deliberately ephemeral and local. They reset when a new counting epoch starts and are not sent to Community by this milestone.

Individual `LineCrossingEvent`s still contain track/event identifiers internally because they are local semantic events. Those identifiers remain behind the edge/privacy boundary and are not part of Community payloads.

## Persistence and privacy

Database:

- `Konta2rCountingGeometryDB`;
- store: `geometry`;
- key: `current`.

Only geometry/configuration metadata is persisted.

The store contains no:

- image or video frame;
- detection;
- bounding box;
- track identifier;
- Community node identity;
- credential.

The local crossing counters introduced by the runtime integration are not persisted by this component.

## Validation coverage

Tests now verify that:

- counting can be enabled after the pipeline is already running;
- an empty geometry list disables counting;
- replacing geometry resets tracker/event history before the next frame;
- caller mutation cannot alter the active cloned line;
- geometry supplied to NanoDet before lazy initialization is actually used;
- the public `resetTrackingAndEvents()` boundary starts a clean trajectory epoch.

## Remaining Community gate

The next step is **not** more line geometry. It is the privacy-preserving aggregation boundary:

1. consume local `LineCrossingEvent`s;
2. aggregate them into time buckets by direction/entity class;
3. remove event-level and track-level identity before persistence/synchronization;
4. feed only aggregate bucket records to the existing Community outbox;
5. guarantee that missing/deleted geometry means no flow bucket can be produced;
6. validate offline accumulation, retry/idempotency and bucket closure semantics.

Only after that gate passes should Konta2r claim that a phone is producing Community flow counts.
