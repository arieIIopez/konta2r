# NanoDet field pilot runtime

## Status

**Experimental field pilot only. NanoDet is not selected as the Konta2r production detector.**

This runtime exists to obtain reproducible evidence on real phones before any model-selection decision. The registered candidate remains:

- `opencv-nanodet-m-plus-1.5x-416-2022nov`;
- technically probe-verified;
- externally downloaded;
- `redistributionVerified=false`;
- subject to representative accuracy/performance benchmarking and a separate weights-license review.

No ONNX checkpoint is bundled in the Konta2r repository or application bundle by this feature.

## Explicit opt-in

The standard build keeps the experimental detector disabled.

To create a field-pilot build, set:

```text
VITE_KONTA2R_EXPERIMENTAL_DETECTOR=nanodet
```

The flag only enables the pilot integration. The checkpoint is still not downloaded until the user starts the node and inference initialization is actually requested.

Unset the variable for the standard build.

## Artifact identity

The pilot uses the registered upstream artifact and expected SHA-256 from `modelCandidates.ts`.

On a network load:

1. download the upstream ONNX bytes with `cache: no-store`;
2. compute SHA-256 with Web Crypto;
3. reject the artifact if the digest differs from the registered digest;
4. only then construct the verified experimental detector adapter;
5. optionally persist the verified bytes in IndexedDB.

On a cache hit, the bytes are hashed again before they are returned to the runtime. IndexedDB is therefore a performance/reliability cache, not an integrity authority.

Cache database:

- `Konta2rOnnxArtifactCacheDB`;
- store: `artifacts`;
- key: model SHA-256.

If persistence fails because of quota or browser policy, the already verified in-memory model can still run for that session.

## Lazy runtime boundary

The normal node UI does not statically import the NanoDet/ONNX pilot implementation. `bootstrap.ts` dynamically imports the pilot factory only when the explicit experimental flag is present.

`NanoDetPilotPipeline` is lazy again at runtime: construction does not fetch or initialize a checkpoint. The first `initialize()` request performs the external load and creates the semantic pipeline.

This keeps the standard Konta2r path independent from the experimental checkpoint and avoids paying the pilot runtime cost in ordinary builds.

## Inference behavior

The pilot reuses the existing `RuntimeInferenceBridge` and therefore inherits:

- non-overlapping inference;
- target frequency from the active `eco`, `balanced` or `performance` profile;
- runtime processing samples for health monitoring;
- WebGPU-first execution when available, with WASM fallback;
- stop/restart behavior driven by the node runtime and camera lifecycle.

The Node panel exposes only local operational telemetry:

- detector state/backend;
- verified artifact source (`cache` or `network`);
- abbreviated model SHA-256;
- detections per processed frame;
- fused mobility entities;
- confirmed tracks;
- observed/median inference cadence and p95 processing latency.

These values are diagnostic evidence, not a validation score.

## Durable field-pilot evidence

Pilot builds also keep a local performance evidence log in `Konta2rFieldPilotDB`.

The database has separate `sessions` and `samples` stores. A session starts when the node becomes operational and is finalized when it stops. If the browser/app closes before a clean stop, a still-active session is marked `interrupted` when the recorder starts again.

The recorder deliberately does **not** write on every inference. It stores:

- an initial sample;
- a sample at the configured interval (30 seconds by default);
- an extra sample when operational state changes materially, such as profile, network, camera, load pressure, detector state or backend;
- a final sample when the node stops.

This limits write pressure on old phones while preserving the changes needed to interpret long runs.

Each sample can contain only operational data such as:

- active profile;
- camera resolution/frame rate metadata;
- online/offline state;
- observed inference rate;
- median inference cadence from the runtime health window;
- processing latency p95 from the runtime health window;
- dropped-frame ratio;
- latency drift ratio;
- load-pressure classification;
- observation uptime/gaps;
- detector pilot state/backend;
- aggregate numeric counts for detections, fused entities and confirmed tracks at the sampled instant.

The recorder never reads Community node identity or credentials.

The package version exported in evidence is sourced directly from `package.json` through `src/version.ts`, preventing a manually duplicated version string from silently drifting.

### Export

`Exportar evidencia piloto` writes one local JSON report for the current or most recent pilot session.

The report contains:

- the session manifest;
- the sampled runtime series;
- a summary of the sampled windows;
- explicit privacy flags;
- explicit interpretation flags declaring that the file is performance evidence only and does not claim ground-truth accuracy or production selection.

Summary names intentionally retain the word `Window` where appropriate. For example, `latencyP95WindowP95Ms` is the p95 across the sequence of **window-level p95 latency observations**. It is not presented as if raw per-inference latency samples had been retained for the entire session.

Likewise, `observedFpsWindowP50` and `droppedFrameRatioWindowP95` summarize the periodic runtime health windows, not a hidden stream of raw frames.

## Privacy boundary

The pilot processes camera frames locally.

It does not add any new frame/image upload path. The UI displays numeric semantic summaries only.

No counting line is injected by the pilot. Consequently its `EdgeMobilityPipelineFrame.crossings` remains empty until a real, user-configured counting geometry is added in a later milestone.

This is intentional: a fabricated default geometry would create apparently valid but spatially meaningless counts.

Community publication remains independent and does not receive event-level detections, tracks, boxes, frames or images.

The field-pilot evidence schema additionally excludes:

- images or frame payloads;
- bounding boxes;
- track IDs or event IDs;
- crossing coordinates;
- Community node IDs;
- sensor credentials;
- human access tokens.

A recursive export guard rejects forbidden keys before a report is returned to the UI.

The evidence file is not uploaded automatically. Export is an explicit local action by the operator.

## Failure and retry semantics

A failed download or failed ONNX initialization leaves the pilot in an explicit `error` state.

The same `NanoDetPilotPipeline` instance may retry initialization. Before an initialization error is propagated, any partially constructed semantic pipeline/detector is disposed. A failed first attempt therefore cannot leave an orphan ONNX session behind or force a page reload before retrying.

Disposing the pilot while initialization is in flight also prevents the completed detector from becoming active after the node has already been torn down.

Evidence persistence is intentionally non-fatal to inference. If IndexedDB evidence recording/export fails, the UI reports the local evidence error but the detector/runtime is not stopped because of that secondary diagnostic subsystem.

## Field-test interpretation

A successful field run demonstrates that a specific verified NanoDet checkpoint can execute through the Konta2r detector/fusion/tracking pipeline on that browser/device.

It does **not** establish:

- production selection;
- weights redistribution permission;
- acceptable precision/recall;
- acceptable cyclist/motorcyclist fusion accuracy;
- long-duration thermal stability unless the run duration actually supports that claim;
- acceptable performance on old phones as a class;
- ground-truth counting accuracy.

Those decisions remain behind the benchmark and license gates documented in `docs/benchmarks/detectors.md`.

## Minimum pilot procedure

For each test phone:

1. activate the explicit NanoDet pilot build;
2. start the node and verify the model SHA/backend shown in the UI;
3. allow the run to reach the duration required by the test protocol;
4. exercise realistic visibility/network interruptions where appropriate;
5. stop the node cleanly when possible;
6. use `Exportar evidencia piloto` to save the JSON evidence;
7. retain qualitative scene notes separately when they are needed to interpret the run, without placing identifiable imagery in ordinary node telemetry;
8. compare field-runtime evidence with the separate annotated benchmark outputs before making detector-selection decisions.

The next scientific milestone is to accumulate these reproducible device/runtime records alongside the already implemented annotated detector benchmark, then compare candidates by device stratum rather than selecting a single detector from desktop performance alone.
