import type { DetectorCandidateRecord } from '../modelCandidates';
import { assessCandidateProbeCompatibility } from './candidateProbeCompatibility';
import type { OnnxModelProbeResult } from './modelProbe';
import type { OnnxCandidateProbeDiagnosticRecord } from './probeDiagnostic';

export type ProbeVerificationStatus = 'verified' | 'incomplete' | 'rejected';
export type ProbeVerificationSeverity = 'warning' | 'error';

export interface ProbeVerificationFinding {
  code:
    | 'candidate_id_mismatch'
    | 'artifact_url_mismatch'
    | 'artifact_hash_mismatch'
    | 'metadata_incomplete'
    | 'codec_not_assessed'
    | 'codec_incompatible'
    | 'stored_assessment_mismatch'
    | 'input_hint_not_confirmed';
  severity: ProbeVerificationSeverity;
  message: string;
}

export interface ProbeVerificationResult {
  schemaVersion: '1';
  status: ProbeVerificationStatus;
  candidateId: string;
  artifactSha256: string;
  findings: ProbeVerificationFinding[];
  recomputedCodecCompatibility: ReturnType<typeof assessCandidateProbeCompatibility>;
}

function probeFromDiagnostic(
  diagnostic: OnnxCandidateProbeDiagnosticRecord,
): OnnxModelProbeResult {
  const record = diagnostic.probe;
  return {
    runtime: {
      ...record.runtime,
      executionProviders: [...record.runtime.executionProviders],
    },
    webgpuAttempted: record.webgpuAttempted,
    ...(record.fallbackReason === undefined ? {} : { fallbackReason: record.fallbackReason }),
    inputs: record.inputs.map((value) => ({
      ...value,
      ...(value.shape === undefined ? {} : { shape: [...value.shape] }),
    })),
    outputs: record.outputs.map((value) => ({
      ...value,
      ...(value.shape === undefined ? {} : { shape: [...value.shape] }),
    })),
  };
}

function sameStringArrays(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * Verifies whether a saved diagnostic is sufficient technical evidence to
 * propose changing a candidate from probe_pending to probe_verified.
 *
 * The derived codec assessment stored in the JSON is never trusted directly:
 * compatibility is recomputed from the primary IO metadata in the probe.
 * License eligibility and detector accuracy are deliberately out of scope.
 */
export function verifyCandidateProbeDiagnostic(
  candidate: DetectorCandidateRecord,
  diagnostic: OnnxCandidateProbeDiagnosticRecord,
): ProbeVerificationResult {
  const findings: ProbeVerificationFinding[] = [];
  const record = diagnostic.probe;
  const identityMismatch = record.candidateId !== candidate.id
    || diagnostic.codecCompatibility.candidateId !== candidate.id;

  if (identityMismatch) {
    findings.push({
      code: 'candidate_id_mismatch',
      severity: 'error',
      message: `Diagnostic candidate identity does not match registered candidate ${candidate.id}.`,
    });
  }

  if (record.artifact.sourceUrl !== candidate.artifact.url) {
    findings.push({
      code: 'artifact_url_mismatch',
      severity: 'error',
      message: 'Diagnostic artifact URL differs from the registered candidate source URL.',
    });
  }

  if (record.artifact.sha256.toLowerCase() !== candidate.artifact.sha256.toLowerCase()) {
    findings.push({
      code: 'artifact_hash_mismatch',
      severity: 'error',
      message: 'Diagnostic checkpoint SHA-256 differs from the registered candidate hash.',
    });
  }

  if (record.metadataCompleteness !== 'complete') {
    findings.push({
      code: 'metadata_incomplete',
      severity: 'warning',
      message: `Probe metadata is ${record.metadataCompleteness}; complete tensor metadata is required for technical verification.`,
    });
  }

  const recomputed = assessCandidateProbeCompatibility(candidate, probeFromDiagnostic(diagnostic));
  if (recomputed.status === 'not_assessed') {
    findings.push({
      code: 'codec_not_assessed',
      severity: 'warning',
      message: 'No registered codec contract can assess this candidate yet.',
    });
  } else if (recomputed.status === 'incompatible') {
    findings.push({
      code: 'codec_incompatible',
      severity: 'error',
      message: `Observed ONNX contract is incompatible with the registered codec: ${recomputed.errors.join(', ')}`,
    });
  }

  const stored = diagnostic.codecCompatibility;
  if (
    stored.codecId !== recomputed.codecId
    || stored.status !== recomputed.status
    || !sameStringArrays(stored.errors, recomputed.errors)
    || !sameStringArrays(stored.warnings, recomputed.warnings)
  ) {
    findings.push({
      code: 'stored_assessment_mismatch',
      severity: 'error',
      message: 'Stored codec assessment does not match the assessment recomputed from primary probe metadata.',
    });
  }

  if (candidate.inputHint && record.inputHintAssessment.dimensionsMatch !== true) {
    findings.push({
      code: 'input_hint_not_confirmed',
      severity: 'warning',
      message: 'Observed input metadata does not positively confirm the registered input-dimension hint.',
    });
  }

  const hasError = findings.some((finding) => finding.severity === 'error');
  const status: ProbeVerificationStatus = hasError
    ? 'rejected'
    : findings.length > 0
      ? 'incomplete'
      : 'verified';

  return {
    schemaVersion: '1',
    status,
    candidateId: candidate.id,
    artifactSha256: candidate.artifact.sha256.toLowerCase(),
    findings,
    recomputedCodecCompatibility: {
      ...recomputed,
      errors: [...recomputed.errors],
      warnings: [...recomputed.warnings],
    },
  };
}
