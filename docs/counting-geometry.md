# Counting geometry on the node

## Purpose

Konta2r must not publish flow counts until the operator has defined a real counting geometry for the camera view.

The first field geometry is one finite, oriented line. It is stored in normalized source-frame coordinates and can later be passed directly to `TrackCountingEngine` / `EdgeMobilityPipeline`.

This milestone deliberately separates **configuration** from **activation in the counting pipeline**. Saving a line does not yet claim that Community flow publication is enabled.

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

## Remaining integration gate

The next step is to bind the saved configuration to the semantic pilot/runtime so that:

1. a configured line creates the `TrackCountingEngine`;
2. changing geometry safely resets event/tracking state at a defined boundary;
3. `LineCrossingEvent`s generated from that real geometry feed the privacy-first Community bucket collector;
4. deleting the geometry disables flow publication rather than falling back to a default line.

This gate should be completed before claiming the phone is producing Community flow counts.
