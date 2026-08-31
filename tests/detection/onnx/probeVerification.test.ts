import { describe, expect, it } from 'vitest';
import {
  OPENCV_SSD_MOBILENET_V2_COCO_2026JUL,
  type DetectorCandidateRecord,
} from '../../../src/detection/modelCandidates';
import { assessCandidateProbeCompatibility } from '../../../src/detection/onnx/candidateProbeCompatibility';
import type { OnnxModelProbeResult } from '../../../src/detection/onnx/modelProbe';
import {
  buildOnnxCandidateProbeDiagnosticRecord,
  type OnnxCandidateProbeDiagnosticRecord,
} from '../../../src/detection/onnx/probeDiagnostic';
import { buildOnnxProbeRecord } from '../../../src/detection/onnx/probeRecord';
import { verifyCandidateProbeDiagnostic } from '../../../src/detection/onnx/probeVerification';

function completeProbe(): OnnxModelProbeResult {
  return {
    runtime: {
      runtime: 'onnxruntime-web',
      runtimeVersion: '1.29.0',
      backend: 'wasm',
      executionProviders: ['wasm'],
    },
    webgpuAttempted: false,
    inputs: [{
      name: 'image_tensor:0',
      kind: 'tensor',
      type: 'uint8',
      shape: [1, 300, 300, 3],
    }],
    outputs: [
      { name: 'detection_boxes:0', kind: 'tensor', type: 'float32', shape: [1, 100, 4] },
      { name: 'detection_scores:0', kind: 'tensor', type: 'float32', shape: [1, 100] },
      { name: 'detection_classes:0', kind: 'tensor', type: 'float32', shape: [1, 100] },
      { name: 'num_detections:0', kind: 'tensor', type: 'float32', shape: [1] },
    ],
  };
}

function diagnosticFor(
  candidate: DetectorCandidateRecord = OPENCV_SSD_MOBILENET_V2_COCO_2026JUL,
  probe: OnnxModelProbeResult = completeProbe(),
): OnnxCandidateProbeDiagnosticRecord {
  const record = buildOnnxProbeRecord(
    candidate,
    {
      sha256: candidate.artifact.sha256,
      sizeBytes: 69_600_000,
    },
    probe,
    new Date('2026-08-31T03:30:00.000Z'),
  );
  return buildOnnxCandidateProbeDiagnosticRecord(
    record,
    assessCandidateProbeCompatibility(candidate, probe),
  );
}

describe('technical ONNX probe verification gate', () => {
  it('verifies complete primary metadata with matching artifact identity and codec contract', () => {
    const result = verifyCandidateProbeDiagnostic(
      OPENCV_SSD_MOBILENET_V2_COCO_2026JUL,
      diagnosticFor(),
    );

    expect(result.status).toBe('verified');
    expect(result.findings).toEqual([]);
    expect(result.recomputedCodecCompatibility.status).toBe('compatible');
  });

  it('rejects a diagnostic whose checkpoint hash differs from the registered artifact', () => {
    const diagnostic = diagnosticFor();
    diagnostic.probe.artifact.sha256 = 'b'.repeat(64);

    const result = verifyCandidateProbeDiagnostic(
      OPENCV_SSD_MOBILENET_V2_COCO_2026JUL,
      diagnostic,
    );

    expect(result.status).toBe('rejected');
    expect(result.findings.some((finding) => finding.code === 'artifact_hash_mismatch')).toBe(true);
  });

  it('treats names-only metadata as incomplete evidence rather than proof of model incompatibility', () => {
    const probe: OnnxModelProbeResult = {
      ...completeProbe(),
      inputs: [{ name: 'image_tensor:0', kind: 'unknown' }],
      outputs: [
        { name: 'detection_boxes:0', kind: 'unknown' },
        { name: 'detection_scores:0', kind: 'unknown' },
        { name: 'detection_classes:0', kind: 'unknown' },
        { name: 'num_detections:0', kind: 'unknown' },
      ],
    };
    const result = verifyCandidateProbeDiagnostic(
      OPENCV_SSD_MOBILENET_V2_COCO_2026JUL,
      diagnosticFor(OPENCV_SSD_MOBILENET_V2_COCO_2026JUL, probe),
    );

    expect(result.status).toBe('incomplete');
    expect(result.findings.some((finding) => finding.code === 'metadata_incomplete')).toBe(true);
    expect(result.findings.find((finding) => finding.code === 'codec_incompatible')?.severity).toBe('warning');
  });

  it('rejects a complete but genuinely incompatible ONNX contract', () => {
    const probe: OnnxModelProbeResult = {
      ...completeProbe(),
      inputs: [{ name: 'images', kind: 'tensor', type: 'float32', shape: [1, 3, 640, 640] }],
    };
    const result = verifyCandidateProbeDiagnostic(
      OPENCV_SSD_MOBILENET_V2_COCO_2026JUL,
      diagnosticFor(OPENCV_SSD_MOBILENET_V2_COCO_2026JUL, probe),
    );

    expect(result.status).toBe('rejected');
    expect(result.findings.find((finding) => finding.code === 'codec_incompatible')?.severity).toBe('error');
  });

  it('rejects a tampered stored codec assessment even when primary probe metadata is valid', () => {
    const diagnostic = diagnosticFor();
    diagnostic.codecCompatibility.status = 'incompatible';
    diagnostic.codecCompatibility.errors.push('fabricated_error');

    const result = verifyCandidateProbeDiagnostic(
      OPENCV_SSD_MOBILENET_V2_COCO_2026JUL,
      diagnostic,
    );

    expect(result.status).toBe('rejected');
    expect(result.findings.some((finding) => finding.code === 'stored_assessment_mismatch')).toBe(true);
    expect(result.recomputedCodecCompatibility.status).toBe('compatible');
  });

  it('keeps a candidate without a codec contract incomplete instead of verifying it by identity alone', () => {
    const base = OPENCV_SSD_MOBILENET_V2_COCO_2026JUL;
    const candidate: DetectorCandidateRecord = {
      id: 'future-candidate',
      displayName: 'Future candidate',
      architecture: 'FutureDetector',
      role: 'performance_candidate',
      status: 'probe_pending',
      dataset: 'custom',
      artifact: {
        ...base.artifact,
        url: 'https://example.test/future.onnx',
        sha256: 'c'.repeat(64),
      },
      sourceRepository: 'https://example.test/source',
      notes: [],
      evidenceUrls: [],
    };
    const probe: OnnxModelProbeResult = {
      ...completeProbe(),
      inputs: [{ name: 'future_input', kind: 'tensor', type: 'float32', shape: [1, 3, 640, 640] }],
      outputs: [{ name: 'future_output', kind: 'tensor', type: 'float32', shape: [1, 84, 8400] }],
    };
    const result = verifyCandidateProbeDiagnostic(candidate, diagnosticFor(candidate, probe));

    expect(result.status).toBe('incomplete');
    expect(result.findings.some((finding) => finding.code === 'codec_not_assessed')).toBe(true);
  });
});
