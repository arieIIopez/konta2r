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
    | 'codec_unconfirmed'
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

function runtimeSmokeConfirmsInputHint(
  candidate: DetectorCandidateRecord,
  diagnostic: OnnxCandidateProbeDiagnosticRecord,
): boolean {
  const hint = candidate.inputHint;
  const smoke = diagnostic.probe.runtimeSmoke;
  if (!hint || !smoke?.passed) return false;
  const shape = smoke.input.shape;
  if (hint.layout === 'NHWC') {
    return shape.length === 4
      && shape[0] === 1
      && shape[1] === hint.height
      && shape[2] === hint.width
      && shape[3] === 3;
  }
  return shape.includes(hint.width) && shape.includes(hint.height);
}

/**
 * Verifies whether a saved diagnostic is sufficient technical evidence to
 * propose changing a candidate from probe_pending to probe_verified.
 *
 * The derived codec assessment stored in the JSON is never trusted directly:
 * compatibility is recomputed from primary IO metadata plus optional executed
 * runtime smoke evidence. License eligibility and detector accuracy remain out
 * of scope.
 */
export function verifyCandidateProbeDiagnostic(
  candidate: DetectorCandidateRecord,
  diagnostic: OnnxCandidateProbeDiagnosticRecord,
): ProbeVerificationResult {
  const findings: ProbeVerificationFinding[] = [];
  const record = diagnostic.probe;
  const metadataComplete = record.metadataCompleteness === 'complete';
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

  if (!metadataComplete) {
    findings.push({
      code: 'metadata_incomplete',
      severity: 'warning',
      message: `Probe metadata is ${record.metadataCompleteness}; complete tensor metadata is required for technical verification.`,
    });
  }

  const recomputed = assessCandidateProbeCompatibility(
    candidate,
    probeFromDiagnostic(diagnostic),
    record.runtimeSmoke,
  );
  if (recomputed.status === 'not_assessed') {
    findings.push({
      code: 'codec_not_assessed',
      severity: 'warning',
      message: 'No registered codec contract can assess this candidate yet.',
    });
  } else if (recomputed.status === 'unconfirmed') {
    findings.push({
      code: 'codec_unconfirmed',
      severity: 'warning',
      message: 'The observed codec metadata is plausible but symbolic dimensions require executed runtime smoke evidence.',
    });
  } else if (recomputed.status === 'incompatible') {
    findings.push({
      code: 'codec_incompatible',
      severity: metadataComplete ? 'error' : 'warning',
      message: metadataComplete
        ? `Observed ONNX contract is incompatible with the registered codec: ${recomputed.errors.join(', ')}`
        : 'Codec compatibility cannot be established because the primary tensor metadata is incomplete.',
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
      message: 'Stored codec assessment does not match the assessment recomputed from primary probe evidence.',
    });
  }

  if (
    candidate.inputHint
    && record.inputHintAssessment.dimensionsMatch !== true
    && !runtimeSmokeConfirmsInputHint(candidate, diagnostic)
  ) {
    findings.push({
      code: 'input_hint_not_confirmed',
      severity: 'warning',
      message: 'Neither static input metadata nor executed runtime evidence positively confirms the registered input-dimension hint.',
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
