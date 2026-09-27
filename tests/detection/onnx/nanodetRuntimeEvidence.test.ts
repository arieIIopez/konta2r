import { describe, expect, it } from 'vitest';
import type { OnnxModelProbeResult } from '../../../src/detection/onnx/modelProbe';
import { assessNanoDetTechnicalEvidence } from '../../../src/detection/onnx/nanodetRuntimeEvidence';
import type { OnnxRuntimeSmokeEvidence } from '../../../src/detection/onnx/runtimeSmoke';

function probe(): OnnxModelProbeResult {
  return {
    runtime: {
      runtime: 'onnxruntime-web', runtimeVersion: '1.29.0', backend: 'wasm', executionProviders: ['wasm'],
    },
    webgpuAttempted: false,
    inputs: [{ name: 'input.1', kind: 'tensor', type: 'float32', shape: [1, 3, 416, 416] }],
    outputs: [
      { name: '792', kind: 'tensor', type: 'float32', shape: [1, 2704, 80] },
      { name: '814', kind: 'tensor', type: 'float32', shape: [1, 676, 80] },
      { name: '836', kind: 'tensor', type: 'float32', shape: [1, 169, 80] },
      { name: '795', kind: 'tensor', type: 'float32', shape: [1, 2704, 32] },
      { name: '817', kind: 'tensor', type: 'float32', shape: [1, 676, 32] },
      { name: '839', kind: 'tensor', type: 'float32', shape: [1, 169, 32] },
    ],
  };
}

function smoke(): OnnxRuntimeSmokeEvidence {
  return {
    schemaVersion: '1', attempted: true, passed: true,
    input: { name: 'input.1', type: 'float32', shape: [1, 3, 416, 416] },
    outputs: [
      { name: '792', type: 'float32', shape: [1, 2704, 80], dataLength: 216320 },
      { name: '814', type: 'float32', shape: [1, 676, 80], dataLength: 54080 },
      { name: '836', type: 'float32', shape: [1, 169, 80], dataLength: 13520 },
      { name: '795', type: 'float32', shape: [1, 2704, 32], dataLength: 86528 },
      { name: '817', type: 'float32', shape: [1, 676, 32], dataLength: 21632 },
      { name: '839', type: 'float32', shape: [1, 169, 32], dataLength: 5408 },
    ],
    findings: [],
  };
}

describe('NanoDet technical evidence gate', () => {
  it('keeps a static-compatible graph unconfirmed without executed runtime evidence', () => {
    const assessment = assessNanoDetTechnicalEvidence(probe());
    expect(assessment.compatible).toBe(true);
    expect(assessment.confirmed).toBe(false);
    expect(assessment.warnings).toContain('nanodet_runtime_smoke_required');
  });

  it('confirms the candidate when Web/WASM reproduces the observed contract exactly', () => {
    const assessment = assessNanoDetTechnicalEvidence(probe(), smoke());
    expect(assessment).toMatchObject({ compatible: true, confirmed: true, errors: [] });
  });

  it('rejects a runtime output whose executed shape drifts from the probed checkpoint', () => {
    const executed = smoke();
    const output = executed.outputs.find((value) => value.name === '839');
    if (!output) throw new Error('test output missing');
    output.shape = [1, 170, 32];
    const assessment = assessNanoDetTechnicalEvidence(probe(), executed);
    expect(assessment.compatible).toBe(false);
    expect(assessment.confirmed).toBe(false);
    expect(assessment.errors.some((value) => value.startsWith('nanodet_runtime_output_mismatch:839'))).toBe(true);
  });
});
