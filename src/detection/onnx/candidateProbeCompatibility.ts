import type { DetectorCandidateRecord } from '../modelCandidates';
import type { OnnxModelProbeResult } from './modelProbe';
import { assessSsdTfProbeCompatibility } from './ssdTfObjectDetection';

export type CandidateProbeCompatibilityStatus = 'compatible' | 'incompatible' | 'not_assessed';

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
 * candidate. It does not mutate candidate status and does not make any license
 * or benchmark-quality decision.
 */
export function assessCandidateProbeCompatibility(
  candidate: DetectorCandidateRecord,
  probe: OnnxModelProbeResult,
): CandidateProbeCompatibility {
  if (candidate.codecId === 'ssd_tf_object_detection') {
    const assessment = assessSsdTfProbeCompatibility(probe);
    return {
      schemaVersion: '1',
      candidateId: candidate.id,
      codecId: candidate.codecId,
      status: assessment.compatible ? 'compatible' : 'incompatible',
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
