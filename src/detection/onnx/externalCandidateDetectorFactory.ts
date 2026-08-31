import type { DetectorCandidateRecord } from '../modelCandidates';
import type { RegisteredDetectorModel } from '../modelRegistry';
import { OnnxDetectorAdapter } from './adapter';
import type { OnnxCandidateProbeDiagnosticRecord } from './probeDiagnostic';
import type { OnnxModelProbeResult } from './modelProbe';
import type { VerifiedOnnxArtifact } from './modelArtifact';
import { verifyCandidateProbeDiagnostic } from './probeVerification';
import {
  SSD_TF_MOBILITY_COCO_CLASS_MAP,
  SsdTfObjectDetectionCodec,
  type SsdTfFrameContext,
  type SsdTfRgbResize,
} from './ssdTfObjectDetection';
import type {
  OnnxRuntimeCapabilities,
  OnnxSessionFactory,
} from './runtime';

export interface ExternalCandidateDetectorFactoryOptions {
  minConfidence?: number;
  maxDetections?: number | (() => number);
  capabilities?: OnnxRuntimeCapabilities;
  sessionFactory?: OnnxSessionFactory;
  preferWebGpu?: boolean;
  /** Test/advanced hook. Production field diagnostics should normally use the default canvas resizer. */
  ssdRgbResize?: SsdTfRgbResize;
}

export interface ExternalCandidateDetectorBuild<TContext = unknown> {
  detector: OnnxDetectorAdapter<TContext>;
  model: RegisteredDetectorModel;
  candidateId: string;
  probeVerified: true;
  redistributionVerified: boolean;
}

function probeFromDiagnostic(
  diagnostic: OnnxCandidateProbeDiagnosticRecord,
): OnnxModelProbeResult {
  const probe = diagnostic.probe;
  return {
    runtime: {
      ...probe.runtime,
      executionProviders: [...probe.runtime.executionProviders],
    },
    webgpuAttempted: probe.webgpuAttempted,
    ...(probe.fallbackReason === undefined ? {} : { fallbackReason: probe.fallbackReason }),
    inputs: probe.inputs.map((value) => ({
      ...value,
      ...(value.shape === undefined ? {} : { shape: [...value.shape] }),
    })),
    outputs: probe.outputs.map((value) => ({
      ...value,
      ...(value.shape === undefined ? {} : { shape: [...value.shape] }),
    })),
  };
}

function uniqueClassNames(map: Readonly<Record<number, string>>): string[] {
  return [...new Set(Object.values(map))];
}

function buildExperimentalModelMetadata(
  candidate: DetectorCandidateRecord,
  artifact: VerifiedOnnxArtifact,
  classNames: string[],
): RegisteredDetectorModel {
  const hint = candidate.inputHint;
  if (!hint || hint.width <= 0 || hint.height <= 0) {
    throw new Error(`Candidate ${candidate.id} does not declare a usable input shape`);
  }
  return {
    adapterId: candidate.codecId ?? 'external-onnx',
    modelId: candidate.id,
    modelVersion: `sha256-${artifact.sha256.slice(0, 12)}`,
    modelSha256: artifact.sha256,
    sourceUrl: candidate.artifact.url,
    weightsRedistributionVerified: candidate.artifact.redistributionVerified,
    inputWidth: hint.width,
    inputHeight: hint.height,
    classNames: [...classNames],
    fileSizeBytes: artifact.sizeBytes,
    registeredAtIso: new Date().toISOString(),
    notes: [
      'External experimental checkpoint loaded in memory after SHA-256 and technical probe verification.',
      `Source declares license: ${candidate.artifact.declaredLicense}. This field is not promoted to weightsLicense until the separate license review is complete.`,
    ],
  };
}

function assertArtifactMatchesCandidate(
  candidate: DetectorCandidateRecord,
  artifact: VerifiedOnnxArtifact,
): void {
  if (artifact.sha256.toLowerCase() !== candidate.artifact.sha256.toLowerCase()) {
    throw new Error('Verified ONNX artifact hash does not match the registered candidate');
  }
  if (artifact.sizeBytes <= 0 || artifact.bytes.byteLength !== artifact.sizeBytes) {
    throw new Error('Verified ONNX artifact byte length is inconsistent');
  }
}

/**
 * Builds a detector for experimental benchmarking from an externally fetched
 * checkpoint. The model bytes remain external/in-memory: this function does not
 * bundle, persist or make any redistribution decision.
 */
export function buildExternalCandidateDetector(
  candidate: DetectorCandidateRecord,
  artifact: VerifiedOnnxArtifact,
  diagnostic: OnnxCandidateProbeDiagnosticRecord,
  options: ExternalCandidateDetectorFactoryOptions = {},
): ExternalCandidateDetectorBuild<SsdTfFrameContext> {
  assertArtifactMatchesCandidate(candidate, artifact);
  const verification = verifyCandidateProbeDiagnostic(candidate, diagnostic);
  if (verification.status !== 'verified') {
    throw new Error(`Candidate probe is not technically verified: ${verification.status}`);
  }

  if (candidate.codecId !== 'ssd_tf_object_detection') {
    throw new Error(`No external detector factory is implemented for codec ${candidate.codecId ?? 'none'}`);
  }

  const probe = probeFromDiagnostic(diagnostic);
  const codec = SsdTfObjectDetectionCodec.fromProbe(probe, {
    ...(options.ssdRgbResize === undefined ? {} : { resizeRgb: options.ssdRgbResize }),
  });
  const model = buildExperimentalModelMetadata(
    candidate,
    artifact,
    uniqueClassNames(SSD_TF_MOBILITY_COCO_CLASS_MAP),
  );
  const detector = new OnnxDetectorAdapter<SsdTfFrameContext>({
    model,
    modelSource: artifact.bytes,
    codec,
    eligibilityMode: 'experiment',
    ...(options.minConfidence === undefined ? {} : { minConfidence: options.minConfidence }),
    ...(options.maxDetections === undefined ? {} : { maxDetections: options.maxDetections }),
    ...(options.capabilities === undefined ? {} : { capabilities: options.capabilities }),
    ...(options.sessionFactory === undefined ? {} : { sessionFactory: options.sessionFactory }),
    ...(options.preferWebGpu === undefined ? {} : { preferWebGpu: options.preferWebGpu }),
  });

  return {
    detector,
    model,
    candidateId: candidate.id,
    probeVerified: true,
    redistributionVerified: candidate.artifact.redistributionVerified,
  };
}
