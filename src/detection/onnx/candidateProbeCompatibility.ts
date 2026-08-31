import type { DetectorCandidateRecord } from '../modelCandidates';
import type { OnnxModelProbeResult } from './modelProbe';
import { assessNanoDetTechnicalEvidence } from './nanodetRuntimeEvidence';
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

function fromTechnicalAssessment(
  candidate: DetectorCandidateRecord,
  assessment: {
    compatible: boolean;
    confirmed: boolean;
    errors: string[];
    warnings: string[];
  },
): CandidateProbeCompatibility {
  return {
    schemaVersion: '1',
    candidateId: candidate.id,
    codecId: candidate.codecId ?? null,
    status: assessment.compatible
      ? assessment.confirmed ? 'compatible' : 'unconfirmed'
      : 'incompatible',
    errors: [...assessment.errors],
    warnings: [...assessment.warnings],
  };
}

/**
 * Resolves probe compatibility through the codec contract declared by the
 * candidate. Runtime evidence is required when a family-specific gate demands
 * execution confirmation. No license or detector-accuracy decision is made here.
 */
export function assessCandidateProbeCompatibility(
  candidate: DetectorCandidateRecord,
  probe: OnnxModelProbeResult,
  runtimeSmoke?: OnnxRuntimeSmokeEvidence,
): CandidateProbeCompatibility {
  if (candidate.codecId === 'ssd_tf_object_detection') {
    return fromTechnicalAssessment(
      candidate,
      assessSsdTfTechnicalEvidence(probe, runtimeSmoke),
    );
  }

  if (candidate.codecId === 'nanodet_plus_gfl') {
    return fromTechnicalAssessment(
      candidate,
      assessNanoDetTechnicalEvidence(probe, runtimeSmoke),
    );
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
