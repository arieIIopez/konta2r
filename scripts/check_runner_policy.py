#!/usr/bin/env python3
"""Reject GitHub-hosted or unexpected runner selectors in active workflows."""
from pathlib import Path
import re
import sys

EXPECTED = {"self-hosted", "linux", "konta2r"}
HOSTED = re.compile(r"(?i)^(ubuntu|windows|macos)(?:-|$)")
RUNS_ON = re.compile(r"^\s*runs-on:\s*(.*?)\s*$")
errors = []
workflow_dir = Path(__file__).resolve().parents[1] / ".github" / "workflows"
for path in sorted((*workflow_dir.glob("*.yml"), *workflow_dir.glob("*.yaml"))):
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        match = RUNS_ON.match(line)
        if not match:
            continue
        value = match.group(1).strip()
        if not (value.startswith("[") and value.endswith("]")):
            errors.append(f"{path}:{number}: runs-on debe ser una lista estática: {value}")
            continue
        labels = {item.strip().strip("'\"").lower() for item in value[1:-1].split(",")}
        hosted = sorted(item for item in labels if HOSTED.match(item))
        if hosted:
            errors.append(f"{path}:{number}: runner GitHub-hosted prohibido: {hosted}")
        if labels != EXPECTED:
            errors.append(f"{path}:{number}: labels {sorted(labels)}; se exige {sorted(EXPECTED)}")
if errors:
    print("\n".join(errors), file=sys.stderr)
    raise SystemExit(1)
print(f"OK: todos los jobs usan {sorted(EXPECTED)}; GitHub-hosted prohibido.")

