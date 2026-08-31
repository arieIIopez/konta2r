import type { DetectorCandidateRecord } from '../modelCandidates';
import type { OnnxModelProbeResult } from './modelProbe';
import type { OnnxRuntimeSmokeEvidence } from './runtimeSmoke';
import { assessSsdTfTechnicalEvidence } from './ssdTfRuntimeEvidence';

export type CandidateProbeCompatibilityStatus =
  | 'compatible'
  | 'unconfirmed'
  | 'incompatible'
  | 'not_assessed';

export interface CandidateProbeCompatibility {
  schemaVersion: '1';
  candidateId: string;
  codecId: string | null;
  status: CandidateProbeCompatibilityStatus;
  errors: string[];
  warnings: string[];
}

/**
 * Resolves probe compatibility through the codec contract declared by the
 * candidate. Symbolic metadata can remain unconfirmed until runtime smoke
 * evidence executes the declared contract. No license or accuracy decision is
 * made here.
 */
export function assessCandidateProbeCompatibility(
  candidate: DetectorCandidateRecord,
  probe: OnnxModelProbeResult,
  runtimeSmoke?: OnnxRuntimeSmokeEvidence,
): CandidateProbeCompatibility {
  if (candidate.codecId === 'ssd_tf_object_detection') {
    const assessment = assessSsdTfTechnicalEvidence(probe, runtimeSmoke);
    return {
      schemaVersion: '1',
      candidateId: candidate.id,
      codecId: candidate.codecId,
      status: assessment.compatible
        ? assessment.confirmed ? 'compatible' : 'unconfirmed'
        : 'incompatible',
      errors: [...assessment.errors],
      warnings: [...assessment.warnings],
    };
  }

  return {
    schemaVersion: '1',
    candidateId: candidate.id,
    codecId: null,
    status: 'not_assessed',
    errors: [],
    warnings: ['candidate_has_no_registered_codec_contract'],
  };
}
