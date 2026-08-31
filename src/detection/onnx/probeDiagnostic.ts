import type { CandidateProbeCompatibility } from './candidateProbeCompatibility';
import type { OnnxProbeRecord } from './probeRecord';

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
    probe: {
      ...probe,
      artifact: { ...probe.artifact },
      runtime: {
        ...probe.runtime,
        executionProviders: [...probe.runtime.executionProviders],
      },
      inputs: probe.inputs.map((value) => ({
        ...value,
        ...(value.shape === undefined ? {} : { shape: [...value.shape] }),
      })),
      outputs: probe.outputs.map((value) => ({
        ...value,
        ...(value.shape === undefined ? {} : { shape: [...value.shape] }),
      })),
      inputHintAssessment: {
        ...probe.inputHintAssessment,
        ...(probe.inputHintAssessment.observedShape === undefined
          ? {}
          : { observedShape: [...probe.inputHintAssessment.observedShape] }),
      },
    },
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
