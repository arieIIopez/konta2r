#!/usr/bin/env python3
import argparse
import json
from pathlib import Path

import numpy as np


def pick_key(data, candidates, label):
    for key in candidates:
        if key in data:
            return key
    raise KeyError(f"Missing {label}; available keys: {sorted(data.files)}")


def as_string(value):
    if isinstance(value, bytes):
        return value.decode("utf-8")
    return str(value)


def main():
    parser = argparse.ArgumentParser(
        description="Extract a small exact predicate subset from RelateAnything predicate_bank.npz."
    )
    parser.add_argument("--bank", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--predicates", nargs="+", required=True)
    args = parser.parse_args()

    bank_path = Path(args.bank)
    output_path = Path(args.output)
    requested = list(dict.fromkeys(p.strip() for p in args.predicates if p.strip()))
    if not requested:
        raise SystemExit("At least one predicate is required")

    with np.load(bank_path, allow_pickle=True) as data:
        names_key = pick_key(data, ["names", "predicates", "vocab", "vocabulary"], "predicate names")
        w_key = pick_key(data, ["W", "w", "embeddings"], "W matrix")
        alpha_key = pick_key(data, ["alpha", "alphas"], "alpha vector")

        names_array = np.asarray(data[names_key]).reshape(-1)
        names = [as_string(value) for value in names_array.tolist()]
        w = np.asarray(data[w_key], dtype=np.float32)
        alpha = np.asarray(data[alpha_key], dtype=np.float32).reshape(-1)

        if w.ndim != 2:
            raise ValueError(f"W must be rank-2, observed shape {w.shape}")
        if w.shape[0] != len(names):
            raise ValueError(f"W rows ({w.shape[0]}) != names ({len(names)})")
        if alpha.shape[0] != len(names):
            raise ValueError(f"alpha rows ({alpha.shape[0]}) != names ({len(names)})")

        threshold_key = next((k for k in ["thr", "thresholds", "threshold"] if k in data), None)
        thresholds = None
        if threshold_key is not None:
            thresholds = np.asarray(data[threshold_key]).reshape(-1)
            if thresholds.shape[0] != len(names):
                raise ValueError(
                    f"threshold rows ({thresholds.shape[0]}) != names ({len(names)})"
                )

        index_by_name = {name: index for index, name in enumerate(names)}
        missing = [name for name in requested if name not in index_by_name]
        if missing:
            raise ValueError(
                "Requested predicates absent from exact bank: " + ", ".join(missing)
            )

        indices = [index_by_name[name] for name in requested]
        rows = w[indices, :]
        alpha_rows = alpha[indices]

        threshold_rows = []
        for index in indices:
            if thresholds is None:
                threshold_rows.append(None)
                continue
            value = float(thresholds[index])
            threshold_rows.append(value if np.isfinite(value) else None)

        metadata = {}
        for key in data.files:
            array = np.asarray(data[key])
            metadata[key] = {
                "dtype": str(array.dtype),
                "shape": list(array.shape),
            }

    payload = {
        "schemaVersion": "1",
        "recordType": "relateanything_predicate_bank_subset",
        "sourceBank": str(bank_path),
        "sourceKeys": metadata,
        "names": requested,
        "indices": indices,
        "dim": int(rows.shape[1]),
        "W": rows.tolist(),
        "alpha": alpha_rows.tolist(),
        "thr": threshold_rows,
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(output_path),
        "names": requested,
        "indices": indices,
        "dim": int(rows.shape[1]),
        "sourceKeys": metadata,
    }, indent=2))


if __name__ == "__main__":
    main()
