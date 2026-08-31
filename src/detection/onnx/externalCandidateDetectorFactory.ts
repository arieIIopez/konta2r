import type { DetectorCandidateRecord } from '../modelCandidates';
import type { RegisteredDetectorModel } from '../modelRegistry';
import { OnnxDetectorAdapter } from './adapter';
import {
  NANODET_PLUS_MOBILITY_COCO_CLASS_MAP,
  NanoDetPlusCodec,
  type NanoDetFrameContext,
  type NanoDetRgbLetterbox,
} from './nanodetPlus';
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
  /** Test/advanced hook for reproducing NanoDet letterbox pixels outside a browser canvas. */
  nanodetRgbLetterbox?: NanoDetRgbLetterbox;
}

export interface ExternalCandidateDetectorBuild<TContext = unknown> {
  detector: OnnxDetectorAdapter<TContext>;
  model: RegisteredDetectorModel;
  candidateId: string;
  probeVerified: true;
  redistributionVerified: boolean;
}

export type SupportedExternalCandidateBuild =
  | ExternalCandidateDetectorBuild<SsdTfFrameContext>
  | ExternalCandidateDetectorBuild<NanoDetFrameContext>;

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

/**
 * A verified runtime smoke may resolve symbolic ONNX metadata into concrete
 * tensor shapes. This view is used only for codec construction after the
 * diagnostic verification gate passes; it never mutates or persists over the
 * primary metadata stored in the diagnostic.
 */
function materializeVerifiedRuntimeContract(
  diagnostic: OnnxCandidateProbeDiagnosticRecord,
): OnnxModelProbeResult {
  const probe = probeFromDiagnostic(diagnostic);
  const smoke = diagnostic.probe.runtimeSmoke;
  if (!smoke?.passed) return probe;
  return {
    ...probe,
    inputs: probe.inputs.map((value) => value.name === smoke.input.name
      ? {
          ...value,
          kind: 'tensor' as const,
          type: smoke.input.type,
          shape: [...smoke.input.shape],
        }
      : value),
    outputs: probe.outputs.map((value) => {
      const observed = smoke.outputs.find((output) => output.name === value.name);
      return observed
        ? {
            ...value,
            kind: 'tensor' as const,
            type: observed.type,
            shape: [...observed.shape],
          }
        : value;
    }),
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

function adapterOptions(
  options: ExternalCandidateDetectorFactoryOptions,
): Pick<
  ConstructorParameters<typeof OnnxDetectorAdapter>[0],
  'maxDetections' | 'capabilities' | 'sessionFactory' | 'preferWebGpu'
> {
  return {
    ...(options.maxDetections === undefined ? {} : { maxDetections: options.maxDetections }),
    ...(options.capabilities === undefined ? {} : { capabilities: options.capabilities }),
    ...(options.sessionFactory === undefined ? {} : { sessionFactory: options.sessionFactory }),
    ...(options.preferWebGpu === undefined ? {} : { preferWebGpu: options.preferWebGpu }),
  };
}

/**
 * Builds an experimental detector from a checkpoint whose identity, ONNX
 * contract and family-specific technical gate are already verified. Model bytes
 * remain external/in-memory; no bundling or redistribution decision is made.
 */
export function buildExternalCandidateDetector(
  candidate: DetectorCandidateRecord,
  artifact: VerifiedOnnxArtifact,
  diagnostic: OnnxCandidateProbeDiagnosticRecord,
  options: ExternalCandidateDetectorFactoryOptions = {},
): SupportedExternalCandidateBuild {
  assertArtifactMatchesCandidate(candidate, artifact);
  const verification = verifyCandidateProbeDiagnostic(candidate, diagnostic);
  if (verification.status !== 'verified') {
    throw new Error(`Candidate probe is not technically verified: ${verification.status}`);
  }

  const codecProbe = materializeVerifiedRuntimeContract(diagnostic);

  if (candidate.codecId === 'ssd_tf_object_detection') {
    const codec = SsdTfObjectDetectionCodec.fromProbe(codecProbe, {
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
      ...adapterOptions(options),
    });
    return {
      detector,
      model,
      candidateId: candidate.id,
      probeVerified: true,
      redistributionVerified: candidate.artifact.redistributionVerified,
    };
  }

  if (candidate.codecId === 'nanodet_plus_gfl') {
    const codec = NanoDetPlusCodec.fromProbe(codecProbe, {
      scoreThreshold: options.minConfidence ?? 0.35,
      ...(options.nanodetRgbLetterbox === undefined
        ? {}
        : { letterboxRgb: options.nanodetRgbLetterbox }),
    });
    const model = buildExperimentalModelMetadata(
      candidate,
      artifact,
      uniqueClassNames(NANODET_PLUS_MOBILITY_COCO_CLASS_MAP),
    );
    const detector = new OnnxDetectorAdapter<NanoDetFrameContext>({
      model,
      modelSource: artifact.bytes,
      codec,
      eligibilityMode: 'experiment',
      ...(options.minConfidence === undefined ? {} : { minConfidence: options.minConfidence }),
      ...adapterOptions(options),
    });
    return {
      detector,
      model,
      candidateId: candidate.id,
      probeVerified: true,
      redistributionVerified: candidate.artifact.redistributionVerified,
    };
  }

  throw new Error(`No external detector factory is implemented for codec ${candidate.codecId ?? 'none'}`);
}
