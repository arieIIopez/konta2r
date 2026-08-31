import { describe, expect, it } from 'vitest';
import type { DetectorCandidateRecord } from '../../../src/detection/modelCandidates';
import { OPENCV_SSD_MOBILENET_V2_COCO_2026JUL } from '../../../src/detection/modelCandidates';
import { assessCandidateProbeCompatibility } from '../../../src/detection/onnx/candidateProbeCompatibility';
import type { OnnxModelProbeResult } from '../../../src/detection/onnx/modelProbe';
import type { OnnxRuntimeSmokeEvidence } from '../../../src/detection/onnx/runtimeSmoke';

function compatibleProbe(): OnnxModelProbeResult {
  return {
    runtime: {
      runtime: 'onnxruntime-web',
      runtimeVersion: '1.29.0',
      backend: 'wasm',
      executionProviders: ['wasm'],
    },
    webgpuAttempted: false,
    inputs: [{ name: 'image_tensor:0', kind: 'tensor', type: 'uint8', shape: [1, 300, 300, 3] }],
    outputs: [
      { name: 'detection_boxes:0', kind: 'tensor', type: 'float32', shape: [1, 100, 4] },
      { name: 'detection_scores:0', kind: 'tensor', type: 'float32', shape: [1, 100] },
      { name: 'detection_classes:0', kind: 'tensor', type: 'float32', shape: [1, 100] },
      { name: 'num_detections:0', kind: 'tensor', type: 'float32', shape: [1] },
    ],
  };
}

function dynamicProbe(): OnnxModelProbeResult {
  return {
    ...compatibleProbe(),
    inputs: [{ name: 'image_tensor:0', kind: 'tensor', type: 'uint8', shape: [1, 'unk__241', 'unk__242', 3] }],
    outputs: [
      { name: 'detection_boxes:0', kind: 'tensor', type: 'float32', shape: [1, 'unk__243', 4] },
      { name: 'detection_scores:0', kind: 'tensor', type: 'float32', shape: [1, 'unk__244'] },
      { name: 'detection_classes:0', kind: 'tensor', type: 'float32', shape: [1, 'unk__244'] },
      { name: 'num_detections:0', kind: 'tensor', type: 'float32', shape: [1] },
    ],
  };
}

function passingSmoke(): OnnxRuntimeSmokeEvidence {
  return {
    schemaVersion: '1',
    attempted: true,
    passed: true,
    input: { name: 'image_tensor:0', type: 'uint8', shape: [1, 300, 300, 3] },
    outputs: [
      { name: 'detection_boxes:0', type: 'float32', shape: [1, 100, 4], dataLength: 400 },
      { name: 'detection_scores:0', type: 'float32', shape: [1, 100], dataLength: 100 },
      { name: 'detection_classes:0', type: 'float32', shape: [1, 100], dataLength: 100 },
      { name: 'num_detections:0', type: 'float32', shape: [1], dataLength: 1 },
    ],
    findings: [],
  };
}

describe('candidate probe compatibility', () => {
  it('routes SSD candidates through the SSD TensorFlow contract', () => {
    const result = assessCandidateProbeCompatibility(
      OPENCV_SSD_MOBILENET_V2_COCO_2026JUL,
      compatibleProbe(),
    );

    expect(result.codecId).toBe('ssd_tf_object_detection');
    expect(result.status).toBe('compatible');
    expect(result.errors).toEqual([]);
  });

  it('keeps symbolic input metadata unconfirmed without executed evidence', () => {
    const result = assessCandidateProbeCompatibility(
      OPENCV_SSD_MOBILENET_V2_COCO_2026JUL,
      dynamicProbe(),
    );
    expect(result.status).toBe('unconfirmed');
    expect(result.warnings).toContain('input_shape_symbolic_runtime_smoke_required');
  });

  it('confirms symbolic metadata when runtime smoke executes the documented contract', () => {
    const result = assessCandidateProbeCompatibility(
      OPENCV_SSD_MOBILENET_V2_COCO_2026JUL,
      dynamicProbe(),
      passingSmoke(),
    );
    expect(result.status).toBe('compatible');
    expect(result.errors).toEqual([]);
    expect(result.warnings).toContain('input_shape_symbolic_validated_by_runtime_smoke');
  });

  it('rejects symbolic metadata when runtime smoke contradicts the contract', () => {
    const smoke = passingSmoke();
    smoke.input.shape = [1, 320, 320, 3];
    const result = assessCandidateProbeCompatibility(
      OPENCV_SSD_MOBILENET_V2_COCO_2026JUL,
      dynamicProbe(),
      smoke,
    );
    expect(result.status).toBe('incompatible');
    expect(result.errors.some((error) => error.startsWith('runtime_input_shape_mismatch'))).toBe(true);
  });

  it('returns incompatible when the registered codec contract does not match', () => {
    const probe = compatibleProbe();
    probe.inputs = [{ name: 'images', kind: 'tensor', type: 'float32', shape: [1, 3, 640, 640] }];

    const result = assessCandidateProbeCompatibility(
      OPENCV_SSD_MOBILENET_V2_COCO_2026JUL,
      probe,
    );

    expect(result.status).toBe('incompatible');
    expect(result.errors.some((error) => error.startsWith('missing_input'))).toBe(true);
  });

  it('does not invent a codec assessment for an unassigned family', () => {
    const candidate: DetectorCandidateRecord = {
      ...OPENCV_SSD_MOBILENET_V2_COCO_2026JUL,
      id: 'future-detector',
      architecture: 'FutureDetector',
      codecId: undefined,
    } as unknown as DetectorCandidateRecord;

    const result = assessCandidateProbeCompatibility(candidate, compatibleProbe());
    expect(result.status).toBe('not_assessed');
    expect(result.codecId).toBeNull();
    expect(result.warnings).toContain('candidate_has_no_registered_codec_contract');
  });
});
