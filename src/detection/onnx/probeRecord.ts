import type { DetectorCandidateRecord } from '../modelCandidates';
import type { OnnxModelProbeResult } from './modelProbe';
import type { OnnxValueMetadata } from './runtime';
import {
  cloneOnnxRuntimeSmokeEvidence,
  type OnnxRuntimeSmokeEvidence,
} from './runtimeSmoke';

export type ProbeMetadataCompleteness = 'complete' | 'partial' | 'names_only' | 'empty';

export interface OnnxProbeRecord {
  schemaVersion: '1.0';
  recordType: 'onnx_model_probe';
  candidateId: string;
  candidateDisplayName: string;
  artifact: {
    sourceUrl: string;
    sha256: string;
    sizeBytes: number;
    declaredLicense: string;
    redistributionVerified: boolean;
  };
  probedAtIso: string;
  runtime: OnnxModelProbeResult['runtime'];
  webgpuAttempted: boolean;
  fallbackReason?: string;
  inputs: OnnxValueMetadata[];
  outputs: OnnxValueMetadata[];
  metadataCompleteness: ProbeMetadataCompleteness;
  inputHintAssessment: {
    expectedWidth?: number;
    expectedHeight?: number;
    expectedLayout?: string;
    observedShape?: readonly (string | number)[];
    dimensionsMatch?: boolean;
  };
  /** Optional executed contract evidence. Required when symbolic metadata cannot confirm dimensions. */
  runtimeSmoke?: OnnxRuntimeSmokeEvidence;
}

function cloneMetadata(values: readonly OnnxValueMetadata[]): OnnxValueMetadata[] {
  return values.map((value) => ({
    ...value,
    ...(value.shape === undefined ? {} : { shape: [...value.shape] }),
  }));
}

export function classifyProbeMetadata(
  inputs: readonly OnnxValueMetadata[],
  outputs: readonly OnnxValueMetadata[],
): ProbeMetadataCompleteness {
  const all = [...inputs, ...outputs];
  if (all.length === 0) return 'empty';
  if (all.every((value) => value.kind === 'unknown')) return 'names_only';
  const tensors = all.filter((value) => value.kind === 'tensor');
  if (
    tensors.length === all.length
    && tensors.every((value) => value.type !== undefined && value.shape !== undefined)
  ) {
    return 'complete';
  }
  return 'partial';
}

function assessInputHint(
  candidate: DetectorCandidateRecord,
  inputs: readonly OnnxValueMetadata[],
): OnnxProbeRecord['inputHintAssessment'] {
  const hint = candidate.inputHint;
  if (!hint) return {};
  const observed = inputs.find((value) => value.kind === 'tensor' && value.shape !== undefined)?.shape;
  const assessment: OnnxProbeRecord['inputHintAssessment'] = {
    expectedWidth: hint.width,
    expectedHeight: hint.height,
    expectedLayout: hint.layout,
  };
  if (!observed) return assessment;
  assessment.observedShape = [...observed];

  const numericDimensions = observed.filter((value): value is number => typeof value === 'number');
  if (numericDimensions.length >= 2) {
    const containsExpectedDimensions = numericDimensions.includes(hint.width)
      && numericDimensions.includes(hint.height);
    assessment.dimensionsMatch = containsExpectedDimensions;
  }
  return assessment;
}

export function buildOnnxProbeRecord(
  candidate: DetectorCandidateRecord,
  artifact: { sha256: string; sizeBytes: number },
  probe: OnnxModelProbeResult,
  probedAt = new Date(),
): OnnxProbeRecord {
  const record: OnnxProbeRecord = {
    schemaVersion: '1.0',
    recordType: 'onnx_model_probe',
    candidateId: candidate.id,
    candidateDisplayName: candidate.displayName,
    artifact: {
      sourceUrl: candidate.artifact.url,
      sha256: artifact.sha256,
      sizeBytes: artifact.sizeBytes,
      declaredLicense: candidate.artifact.declaredLicense,
      redistributionVerified: candidate.artifact.redistributionVerified,
    },
    probedAtIso: probedAt.toISOString(),
    runtime: {
      ...probe.runtime,
      executionProviders: [...probe.runtime.executionProviders],
    },
    webgpuAttempted: probe.webgpuAttempted,
    inputs: cloneMetadata(probe.inputs),
    outputs: cloneMetadata(probe.outputs),
    metadataCompleteness: classifyProbeMetadata(probe.inputs, probe.outputs),
    inputHintAssessment: assessInputHint(candidate, probe.inputs),
  };
  if (probe.fallbackReason !== undefined) record.fallbackReason = probe.fallbackReason;
  return record;
}

export function cloneOnnxProbeRecord(record: OnnxProbeRecord): OnnxProbeRecord {
  return {
    ...record,
    artifact: { ...record.artifact },
    runtime: { ...record.runtime, executionProviders: [...record.runtime.executionProviders] },
    inputs: cloneMetadata(record.inputs),
    outputs: cloneMetadata(record.outputs),
    inputHintAssessment: {
      ...record.inputHintAssessment,
      ...(record.inputHintAssessment.observedShape === undefined
        ? {}
        : { observedShape: [...record.inputHintAssessment.observedShape] }),
    },
    ...(record.runtimeSmoke === undefined
      ? {}
      : { runtimeSmoke: cloneOnnxRuntimeSmokeEvidence(record.runtimeSmoke) }),
  };
}

export function serializeOnnxProbeRecord(record: OnnxProbeRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}
