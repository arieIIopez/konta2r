import {
  DETECTOR_CANDIDATES,
  type DetectorCandidateRecord,
} from '../modelCandidates';
import type { OnnxCandidateProbeDiagnosticRecord } from './probeDiagnostic';
import { parseOnnxCandidateProbeDiagnosticJson } from './probeDiagnosticParser';
import {
  verifyCandidateProbeDiagnostic,
  type ProbeVerificationResult,
} from './probeVerification';

export interface ImportedProbeDiagnosticReview {
  diagnostic: OnnxCandidateProbeDiagnosticRecord;
  candidate: DetectorCandidateRecord;
  verification: ProbeVerificationResult;
}

export function reviewImportedProbeDiagnostic(
  text: string,
  candidates: readonly DetectorCandidateRecord[] = DETECTOR_CANDIDATES,
): ImportedProbeDiagnosticReview {
  const diagnostic = parseOnnxCandidateProbeDiagnosticJson(text);
  const candidate = candidates.find((value) => value.id === diagnostic.probe.candidateId);
  if (!candidate) {
    throw new Error(`Diagnostic candidate ${diagnostic.probe.candidateId} is not registered in this Konta2r build`);
  }
  return {
    diagnostic,
    candidate,
    verification: verifyCandidateProbeDiagnostic(candidate, diagnostic),
  };
}
