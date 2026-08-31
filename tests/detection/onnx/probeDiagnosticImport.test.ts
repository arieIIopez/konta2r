import { describe, expect, it } from 'vitest';
import { OPENCV_SSD_MOBILENET_V2_COCO_2026JUL } from '../../../src/detection/modelCandidates';
import { assessCandidateProbeCompatibility } from '../../../src/detection/onnx/candidateProbeCompatibility';
import type { OnnxModelProbeResult } from '../../../src/detection/onnx/modelProbe';
import {
  buildOnnxCandidateProbeDiagnosticRecord,
  serializeOnnxCandidateProbeDiagnosticRecord,
} from '../../../src/detection/onnx/probeDiagnostic';
import { parseOnnxCandidateProbeDiagnosticJson } from '../../../src/detection/onnx/probeDiagnosticParser';
import { reviewImportedProbeDiagnostic } from '../../../src/detection/onnx/probeDiagnosticReview';
import { buildOnnxProbeRecord } from '../../../src/detection/onnx/probeRecord';

function completeProbe(): OnnxModelProbeResult {
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

function validJson(): string {
  const candidate = OPENCV_SSD_MOBILENET_V2_COCO_2026JUL;
  const probe = completeProbe();
  const probeRecord = buildOnnxProbeRecord(
    candidate,
    { sha256: candidate.artifact.sha256, sizeBytes: 69_600_000 },
    probe,
    new Date('2026-08-31T03:30:00.000Z'),
  );
  return serializeOnnxCandidateProbeDiagnosticRecord(
    buildOnnxCandidateProbeDiagnosticRecord(
      probeRecord,
      assessCandidateProbeCompatibility(candidate, probe),
    ),
  );
}

describe('imported ONNX probe diagnostics', () => {
  it('parses a valid exported diagnostic and preserves primary tensor metadata', () => {
    const parsed = parseOnnxCandidateProbeDiagnosticJson(validJson());
    expect(parsed.probe.candidateId).toBe(OPENCV_SSD_MOBILENET_V2_COCO_2026JUL.id);
    expect(parsed.probe.metadataCompleteness).toBe('complete');
    expect(parsed.probe.inputs[0]?.shape).toEqual([1, 300, 300, 3]);
    expect(parsed.codecCompatibility.status).toBe('compatible');
  });

  it('reviews a valid imported diagnostic as technically verified', () => {
    const review = reviewImportedProbeDiagnostic(validJson());
    expect(review.candidate.id).toBe(OPENCV_SSD_MOBILENET_V2_COCO_2026JUL.id);
    expect(review.verification.status).toBe('verified');
  });

  it('rejects malformed JSON before any candidate or verification logic runs', () => {
    expect(() => parseOnnxCandidateProbeDiagnosticJson('{not json'))
      .toThrow('not valid JSON');
  });

  it('rejects structurally invalid metadata rather than casting it to trusted types', () => {
    const value = JSON.parse(validJson()) as Record<string, any>;
    value.probe.inputs[0].shape = [1, 300, {}, 3];
    expect(() => parseOnnxCandidateProbeDiagnosticJson(JSON.stringify(value)))
      .toThrow('array of strings/numbers');
  });

  it('rejects a diagnostic for a candidate absent from the current registry', () => {
    const value = JSON.parse(validJson()) as Record<string, any>;
    value.probe.candidateId = 'unregistered-candidate';
    value.codecCompatibility.candidateId = 'unregistered-candidate';
    expect(() => reviewImportedProbeDiagnostic(JSON.stringify(value)))
      .toThrow('not registered in this Konta2r build');
  });

  it('passes a structurally valid but altered hash to the verification gate, which rejects it', () => {
    const value = JSON.parse(validJson()) as Record<string, any>;
    value.probe.artifact.sha256 = 'b'.repeat(64);
    const review = reviewImportedProbeDiagnostic(JSON.stringify(value));
    expect(review.verification.status).toBe('rejected');
    expect(review.verification.findings.some((finding) => finding.code === 'artifact_hash_mismatch')).toBe(true);
  });
});
