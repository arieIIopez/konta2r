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

## Privacy boundary

The pilot processes camera frames locally.

It does not add any new frame/image upload path. The UI displays numeric semantic summaries only.

No counting line is injected by the pilot. Consequently its `EdgeMobilityPipelineFrame.crossings` remains empty until a real, user-configured counting geometry is added in a later milestone.

This is intentional: a fabricated default geometry would create apparently valid but spatially meaningless counts.

Community publication remains independent and does not receive event-level detections, tracks, boxes, frames or images.

## Failure and retry semantics

A failed download or failed ONNX initialization leaves the pilot in an explicit `error` state.

The same `NanoDetPilotPipeline` instance may retry initialization. Before an initialization error is propagated, any partially constructed semantic pipeline/detector is disposed. A failed first attempt therefore cannot leave an orphan ONNX session behind or force a page reload before retrying.

Disposing the pilot while initialization is in flight also prevents the completed detector from becoming active after the node has already been torn down.

## Field-test interpretation

A successful field run demonstrates that a specific verified NanoDet checkpoint can execute through the Konta2r detector/fusion/tracking pipeline on that browser/device.

It does **not** establish:

- production selection;
- weights redistribution permission;
- acceptable precision/recall;
- acceptable cyclist/motorcyclist fusion accuracy;
- long-duration thermal stability;
- acceptable performance on old phones as a class;
- ground-truth counting accuracy.

Those decisions remain behind the benchmark and license gates documented in `docs/benchmarks/detectors.md`.

## Minimum pilot procedure

For each test phone record at least:

1. device/browser and Konta2r commit;
2. active runtime profile;
3. WebGPU availability and actual selected backend;
4. whether the artifact came from network or verified cache;
5. model SHA-256 shown by the runtime;
6. sustained inference cadence and p95 processing latency;
7. dropped-frame ratio/load pressure;
8. duration of the run;
9. visible failure/recovery behavior after stopping/restarting the node;
10. qualitative scene conditions, without uploading identifiable imagery as part of ordinary node telemetry.

The next milestone should turn these observations into reproducible benchmark records and only then compare NanoDet against the other detector candidates.
