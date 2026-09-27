import type { CandidateProbeCompatibility } from './candidateProbeCompatibility';
import { cloneOnnxProbeRecord, type OnnxProbeRecord } from './probeRecord';

export interface OnnxCandidateProbeDiagnosticRecord {
  schemaVersion: '1';
  recordType: 'onnx_candidate_probe_diagnostic';
  probe: OnnxProbeRecord;
  codecCompatibility: CandidateProbeCompatibility;
}

export function buildOnnxCandidateProbeDiagnosticRecord(
  probe: OnnxProbeRecord,
  codecCompatibility: CandidateProbeCompatibility,
): OnnxCandidateProbeDiagnosticRecord {
  if (probe.candidateId !== codecCompatibility.candidateId) {
    throw new Error('Probe and codec compatibility candidate ids must match');
  }
  return {
    schemaVersion: '1',
    recordType: 'onnx_candidate_probe_diagnostic',
    probe: cloneOnnxProbeRecord(probe),
    codecCompatibility: {
      ...codecCompatibility,
      errors: [...codecCompatibility.errors],
      warnings: [...codecCompatibility.warnings],
    },
  };
}

export function serializeOnnxCandidateProbeDiagnosticRecord(
  record: OnnxCandidateProbeDiagnosticRecord,
): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}
