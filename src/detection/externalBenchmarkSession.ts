import type { DetectorCandidateRecord } from './modelCandidates';
import {
  createDetectorBenchmarkReport,
  type BenchmarkDeviceIdentity,
  type DetectorBenchmarkReport,
} from './benchmarkReport';
import type { AnnotatedBenchmarkSequence } from './benchmarkDataset';
import {
  assessDetectorBenchmarkValidity,
  type BenchmarkValidityAssessment,
  type BenchmarkValidityPolicy,
} from './benchmarkValidity';
import {
  buildExternalCandidateDetector,
  type ExternalCandidateDetectorFactoryOptions,
} from './onnx/externalCandidateDetectorFactory';
import type { VerifiedOnnxArtifact } from './onnx/modelArtifact';
import type { OnnxCandidateProbeDiagnosticRecord } from './onnx/probeDiagnostic';
import {
  runStreamingAnnotatedBenchmark,
  type BenchmarkFrameProvider,
  type StreamingBenchmarkProgress,
} from './streamingBenchmark';
import type { ImageScaleThresholds } from './benchmarkDataset';

export interface ExternalBenchmarkSessionOptions {
  runId: string;
  createdAtIso?: string;
  device: BenchmarkDeviceIdentity;
  notes?: readonly string[];
  detector?: ExternalCandidateDetectorFactoryOptions;
  benchmark?: {
    iouThreshold?: number;
    imageScaleThresholds?: ImageScaleThresholds;
    onProgress?: (progress: StreamingBenchmarkProgress) => void;
  };
  validity?: BenchmarkValidityPolicy;
}

export interface ExternalBenchmarkSessionResult {
  candidateId: string;
  report: DetectorBenchmarkReport;
  validity: BenchmarkValidityAssessment;
  redistributionVerified: boolean;
}

function corpusFromSequence(sequence: AnnotatedBenchmarkSequence): DetectorBenchmarkReport['corpus'] {
  return {
    datasetId: sequence.datasetId,
    sequenceIds: [sequence.sequenceId],
    frameCount: sequence.frames.length,
    ...(sequence.source?.annotationSha256 === undefined
      ? {}
      : { annotationSha256: sequence.source.annotationSha256 }),
    ...(sequence.source?.mediaSha256 === undefined
      ? {}
      : { mediaSha256: sequence.source.mediaSha256 }),
  };
}

/**
 * End-to-end experimental benchmark boundary for an external model:
 * verified bytes + verified probe → detector → streaming annotated benchmark →
 * reproducible report → scientific validity gate.
 *
 * The function never changes candidate status and never promotes redistribution
 * eligibility. Accuracy/performance and scientific validity remain separate.
 */
export async function runExternalCandidateBenchmarkSession(
  candidate: DetectorCandidateRecord,
  artifact: VerifiedOnnxArtifact,
  diagnostic: OnnxCandidateProbeDiagnosticRecord,
  sequence: AnnotatedBenchmarkSequence,
  provider: BenchmarkFrameProvider,
  options: ExternalBenchmarkSessionOptions,
): Promise<ExternalBenchmarkSessionResult> {
  if (options.runId.trim().length === 0) throw new Error('runId is required');
  const built = buildExternalCandidateDetector(
    candidate,
    artifact,
    diagnostic,
    options.detector,
  );

  const benchmark = await runStreamingAnnotatedBenchmark(
    built.detector,
    sequence,
    provider,
    {
      ...(options.benchmark?.iouThreshold === undefined
        ? {}
        : { iouThreshold: options.benchmark.iouThreshold }),
      ...(options.benchmark?.imageScaleThresholds === undefined
        ? {}
        : { imageScaleThresholds: options.benchmark.imageScaleThresholds }),
      ...(options.benchmark?.onProgress === undefined
        ? {}
        : { onProgress: options.benchmark.onProgress }),
      disposeDetectorAfterRun: true,
    },
  );

  const report = createDetectorBenchmarkReport({
    runId: options.runId,
    ...(options.createdAtIso === undefined ? {} : { createdAtIso: options.createdAtIso }),
    corpus: corpusFromSequence(sequence),
    device: { ...options.device },
    benchmark,
    notes: [
      `external_candidate:${candidate.id}`,
      'Checkpoint executed from externally supplied verified bytes; not bundled by Konta2r.',
      ...(options.notes ?? []),
    ],
  });
  const validity = assessDetectorBenchmarkValidity(report, options.validity);

  return {
    candidateId: candidate.id,
    report,
    validity,
    redistributionVerified: built.redistributionVerified,
  };
}
