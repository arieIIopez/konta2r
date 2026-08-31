#!/usr/bin/env python3
import argparse
import hashlib
import json
import os
import tempfile
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import onnxruntime as ort


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Download an ONNX model, verify its identity, and record the observed ONNX Runtime IO contract."
    )
    parser.add_argument("--url", required=True)
    parser.add_argument("--expected-sha256", required=True)
    parser.add_argument("--expected-size", required=True, type=int)
    parser.add_argument("--output", required=True)
    return parser.parse_args()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def tensor_record(value) -> dict:
    return {
        "name": value.name,
        "type": value.type,
        "shape": list(value.shape),
    }


def main() -> None:
    args = parse_args()
    expected_sha = args.expected_sha256.lower()

    with tempfile.TemporaryDirectory(prefix="konta2r-nanodet-") as temp_dir:
        model_path = Path(temp_dir) / "model.onnx"
        request = urllib.request.Request(
            args.url,
            headers={"User-Agent": "konta2r-evidence-probe/1.0"},
        )
        with urllib.request.urlopen(request, timeout=120) as response, model_path.open("wb") as target:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                target.write(chunk)

        observed_size = model_path.stat().st_size
        observed_sha = sha256_file(model_path)

        if observed_size != args.expected_size:
            raise SystemExit(
                f"size mismatch: expected {args.expected_size}, observed {observed_size}"
            )
        if observed_sha != expected_sha:
            raise SystemExit(
                f"sha256 mismatch: expected {expected_sha}, observed {observed_sha}"
            )

        session = ort.InferenceSession(
            os.fspath(model_path),
            providers=["CPUExecutionProvider"],
        )
        meta = session.get_modelmeta()

        evidence = {
            "schemaVersion": 1,
            "candidateId": "opencv-nanodet-m-plus-1.5x-416-2022nov",
            "source": {
                "url": args.url,
                "expectedSha256": expected_sha,
                "expectedSizeBytes": args.expected_size,
            },
            "artifactObserved": {
                "sha256": observed_sha,
                "sizeBytes": observed_size,
            },
            "probe": {
                "observedAtUtc": datetime.now(timezone.utc).isoformat(),
                "pythonVersion": os.sys.version.split()[0],
                "onnxRuntimeVersion": ort.__version__,
                "availableProviders": ort.get_available_providers(),
                "sessionProviders": session.get_providers(),
                "inputs": [tensor_record(value) for value in session.get_inputs()],
                "outputs": [tensor_record(value) for value in session.get_outputs()],
                "modelMetadata": {
                    "description": meta.description,
                    "domain": meta.domain,
                    "graphName": meta.graph_name,
                    "producerName": meta.producer_name,
                    "version": meta.version,
                    "customMetadataMap": dict(meta.custom_metadata_map),
                },
            },
            "interpretation": {
                "status": "probe_observed",
                "codecAssigned": False,
                "note": "This file records model identity and the ONNX Runtime IO contract only; it does not claim preprocessing or postprocessing correctness.",
            },
        }

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(evidence, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(evidence, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
