import { describe, expect, it } from 'vitest';
import {
  buildOnnxCandidateProbeDiagnosticRecord,
  serializeOnnxCandidateProbeDiagnosticRecord,
} from '../../../src/detection/onnx/probeDiagnostic';
import type { OnnxProbeRecord } from '../../../src/detection/onnx/probeRecord';

const probe: OnnxProbeRecord = {
  schemaVersion: '1.0',
  recordType: 'onnx_model_probe',
  candidateId: 'candidate-a',
  candidateDisplayName: 'Candidate A',
  artifact: {
    sourceUrl: 'https://example.test/model.onnx',
    sha256: 'a'.repeat(64),
    sizeBytes: 10,
    declaredLicense: 'Apache-2.0',
    redistributionVerified: false,
  },
  probedAtIso: '2026-08-31T03:00:00.000Z',
  runtime: {
    runtime: 'onnxruntime-web',
    backend: 'wasm',
    executionProviders: ['wasm'],
  },
  webgpuAttempted: false,
  inputs: [{ name: 'input', kind: 'tensor', type: 'uint8', shape: [1, 300, 300, 3] }],
  outputs: [{ name: 'boxes', kind: 'tensor', type: 'float32', shape: [1, 100, 4] }],
  metadataCompleteness: 'complete',
  inputHintAssessment: {
    expectedWidth: 300,
    expectedHeight: 300,
    expectedLayout: 'NHWC',
    observedShape: [1, 300, 300, 3],
    dimensionsMatch: true,
  },
};

describe('candidate probe diagnostic record', () => {
  it('bundles primary probe evidence and deterministic codec assessment', () => {
    const record = buildOnnxCandidateProbeDiagnosticRecord(probe, {
      schemaVersion: '1',
      candidateId: 'candidate-a',
      codecId: 'ssd_tf_object_detection',
      status: 'compatible',
      errors: [],
      warnings: ['example_warning'],
    });

    expect(record.recordType).toBe('onnx_candidate_probe_diagnostic');
    expect(record.probe.candidateId).toBe('candidate-a');
    expect(record.codecCompatibility.status).toBe('compatible');
    expect(serializeOnnxCandidateProbeDiagnosticRecord(record)).toContain('"codecCompatibility"');
  });

  it('rejects accidental mixing of evidence from different candidates', () => {
    expect(() => buildOnnxCandidateProbeDiagnosticRecord(probe, {
      schemaVersion: '1',
      candidateId: 'candidate-b',
      codecId: null,
      status: 'not_assessed',
      errors: [],
      warnings: [],
    })).toThrow('candidate ids must match');
  });
});
