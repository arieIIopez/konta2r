import { describe, expect, it } from 'vitest';
import type { DetectorCandidateRecord } from '../../../src/detection/modelCandidates';
import { OPENCV_SSD_MOBILENET_V2_COCO_2026JUL } from '../../../src/detection/modelCandidates';
import { assessCandidateProbeCompatibility } from '../../../src/detection/onnx/candidateProbeCompatibility';
import type { OnnxModelProbeResult } from '../../../src/detection/onnx/modelProbe';

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
