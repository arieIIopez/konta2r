import { describe, expect, it } from 'vitest';
import {
  cloneOnnxRuntimeSmokeEvidence,
  validateOnnxRuntimeSmokeEvidence,
  type OnnxRuntimeSmokeEvidence,
} from '../../../src/detection/onnx/runtimeSmoke';

function evidence(): OnnxRuntimeSmokeEvidence {
  return {
    schemaVersion: '1', attempted: true, passed: true,
    input: { name: 'image_tensor:0', type: 'uint8', shape: [1, 300, 300, 3] },
    outputs: [
      { name: 'detection_boxes:0', type: 'float32', shape: [1, 100, 4], dataLength: 400 },
    ],
    findings: [],
  };
}

describe('ONNX runtime smoke evidence', () => {
  it('clones nested tensor shapes without aliasing', () => {
    const source = evidence();
    const cloned = cloneOnnxRuntimeSmokeEvidence(source);
    cloned.input.shape[1] = 320;
    cloned.outputs[0]!.shape[1] = 50;
    expect(source.input.shape).toEqual([1, 300, 300, 3]);
    expect(source.outputs[0]!.shape).toEqual([1, 100, 4]);
  });

  it('rejects duplicate output names', () => {
    const value = evidence();
    value.outputs.push({ ...value.outputs[0]!, shape: [1, 100, 4] });
    expect(() => validateOnnxRuntimeSmokeEvidence(value)).toThrow('duplicated');
  });

  it('rejects negative runtime dimensions', () => {
    const value = evidence();
    value.input.shape = [1, -1, 300, 3];
    expect(() => validateOnnxRuntimeSmokeEvidence(value)).toThrow('input shape is invalid');
  });
});
