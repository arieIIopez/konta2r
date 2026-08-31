import type { DetectorCandidateRecord } from './modelCandidates';
import {
  createDetectorBenchmarkReport,
  type BenchmarkDeviceIdentity,
  type DetectorBenchmarkReport,
} from './benchmarkReport';
import type { AnnotatedBenchmarkSequence, ImageScaleThresholds } from './benchmarkDataset';
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

export interface ExternalBenchmarkCorpusHashes {
  /** SHA-256 computed from the actual annotation file bytes, outside that file. */
  annotationSha256?: string;
  /** SHA-256 computed from the actual local video/media bytes. */
  mediaSha256?: string;
}

export interface ExternalBenchmarkSessionOptions {
  runId: string;
  createdAtIso?: string;
  device: BenchmarkDeviceIdentity;
  notes?: readonly string[];
  /** Externally computed file hashes override manifest values embedded in the sequence JSON. */
  corpusHashes?: ExternalBenchmarkCorpusHashes;
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

function corpusFromSequence(
  sequence: AnnotatedBenchmarkSequence,
  hashes: ExternalBenchmarkCorpusHashes | undefined,
): DetectorBenchmarkReport['corpus'] {
  const annotationSha256 = hashes?.annotationSha256 ?? sequence.source?.annotationSha256;
  const mediaSha256 = hashes?.mediaSha256 ?? sequence.source?.mediaSha256;
  return {
    datasetId: sequence.datasetId,
    sequenceIds: [sequence.sequenceId],
    frameCount: sequence.frames.length,
    ...(annotationSha256 === undefined ? {} : { annotationSha256 }),
    ...(mediaSha256 === undefined ? {} : { mediaSha256 }),
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
    corpus: corpusFromSequence(sequence, options.corpusHashes),
    device: { ...options.device },
    benchmark,
    notes: [
      `external_candidate:${candidate.id}`,
      'Checkpoint executed from externally supplied verified bytes; not bundled by Konta2r.',
      ...(options.corpusHashes?.annotationSha256 === undefined
        ? []
        : ['annotation_sha256_source:externally_computed_file_bytes']),
      ...(options.corpusHashes?.mediaSha256 === undefined
        ? []
        : ['media_sha256_source:externally_computed_file_bytes']),
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
