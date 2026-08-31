import { describe, expect, it } from 'vitest';
import { KALRAY_SSD_MOBILENET_V2_COCO } from '../../../src/detection/modelCandidates';
import {
  buildOnnxProbeRecord,
  classifyProbeMetadata,
  serializeOnnxProbeRecord,
} from '../../../src/detection/onnx/probeRecord';

const runtime = {
  runtime: 'onnxruntime-web' as const,
  runtimeVersion: '1.29.0',
  backend: 'wasm' as const,
  executionProviders: ['wasm' as const],
};

describe('ONNX probe record', () => {
  it('classifies complete tensor metadata separately from names-only probes', () => {
    expect(classifyProbeMetadata(
      [{ name: 'input', kind: 'tensor', type: 'uint8', shape: [1, 300, 300, 3] }],
      [{ name: 'boxes', kind: 'tensor', type: 'float32', shape: [1, 100, 4] }],
    )).toBe('complete');

    expect(classifyProbeMetadata(
      [{ name: 'input', kind: 'unknown' }],
      [{ name: 'output', kind: 'unknown' }],
    )).toBe('names_only');
  });

  it('builds a deterministic record with artifact identity and observed IO', () => {
    const record = buildOnnxProbeRecord(
      KALRAY_SSD_MOBILENET_V2_COCO,
      {
        sha256: KALRAY_SSD_MOBILENET_V2_COCO.artifact.sha256,
        sizeBytes: 67_400_000,
      },
      {
        runtime,
        webgpuAttempted: false,
        inputs: [{ name: 'image_tensor', kind: 'tensor', type: 'uint8', shape: [1, 300, 300, 3] }],
        outputs: [{ name: 'boxes', kind: 'tensor', type: 'float32', shape: [1, 100, 4] }],
      },
      new Date('2026-08-30T22:30:00.000Z'),
    );

    expect(record.candidateId).toBe('kalray-ssd-mobilenet-v2-coco');
    expect(record.artifact.sha256).toBe(KALRAY_SSD_MOBILENET_V2_COCO.artifact.sha256);
    expect(record.artifact.redistributionVerified).toBe(false);
    expect(record.metadataCompleteness).toBe('complete');
    expect(record.inputHintAssessment.dimensionsMatch).toBe(true);
    expect(record.probedAtIso).toBe('2026-08-30T22:30:00.000Z');
    expect(serializeOnnxProbeRecord(record)).toMatch(/"recordType": "onnx_model_probe"/);
  });

  it('does not invent input agreement when no tensor shape is observed', () => {
    const record = buildOnnxProbeRecord(
      KALRAY_SSD_MOBILENET_V2_COCO,
      { sha256: KALRAY_SSD_MOBILENET_V2_COCO.artifact.sha256, sizeBytes: 10 },
      {
        runtime,
        webgpuAttempted: false,
        inputs: [{ name: 'input', kind: 'unknown' }],
        outputs: [{ name: 'output', kind: 'unknown' }],
      },
    );

    expect(record.metadataCompleteness).toBe('names_only');
    expect(record.inputHintAssessment.dimensionsMatch).toBeUndefined();
    expect(record.inputHintAssessment.observedShape).toBeUndefined();
  });
});
