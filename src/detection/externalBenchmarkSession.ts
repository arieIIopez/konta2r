import type { DetectorCandidateRecord } from './modelCandidates';
import {
  createDetectorBenchmarkReport,
  type BenchmarkConfidenceAnalysis,
  type BenchmarkDeviceIdentity,
  type DetectorBenchmarkReport,
} from './benchmarkReport';
import type { AnnotatedBenchmarkSequence, ImageScaleThresholds } from './benchmarkDataset';
import {
  assessDetectorBenchmarkValidity,
  type BenchmarkValidityAssessment,
  type BenchmarkValidityPolicy,
} from './benchmarkValidity';
import { DEFAULT_CONFIDENCE_SWEEP_THRESHOLDS } from './confidenceSweep';
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
import { runStreamingAnnotatedBenchmarkWithConfidenceSweep } from './streamingConfidenceBenchmark';

export interface ExternalBenchmarkCorpusHashes {
  /** SHA-256 computed from the actual annotation file bytes, outside that file. */
  annotationSha256?: string;
  /** SHA-256 computed from the actual local video/media bytes. */
  mediaSha256?: string;
}

export interface ExternalBenchmarkConfidenceOptions {
  operatingConfidenceThreshold?: number;
  sweepThresholds?: readonly number[];
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
    /** Optional one-pass confidence analysis. If omitted, legacy single-point evaluation is used. */
    confidence?: ExternalBenchmarkConfidenceOptions;
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

function minimumSweepThreshold(values: readonly number[] | undefined): number {
  const thresholds = values ?? DEFAULT_CONFIDENCE_SWEEP_THRESHOLDS;
  if (thresholds.length === 0) throw new Error('confidence sweep requires at least one threshold');
  return Math.min(...thresholds);
}

function assertDetectorRetainsSweepEvidence(
  detector: ExternalCandidateDetectorFactoryOptions | undefined,
  confidence: ExternalBenchmarkConfidenceOptions,
): void {
  const detectorFloor = detector?.minConfidence ?? 0;
  const sweepFloor = minimumSweepThreshold(confidence.sweepThresholds);
  if (detectorFloor > sweepFloor + 1e-12) {
    throw new Error(
      `Detector minConfidence ${detectorFloor} exceeds confidence sweep floor ${sweepFloor}; filtered detections cannot be recovered`,
    );
  }
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
  const confidenceOptions = options.benchmark?.confidence;
  if (confidenceOptions) assertDetectorRetainsSweepEvidence(options.detector, confidenceOptions);

  const built = buildExternalCandidateDetector(
    candidate,
    artifact,
    diagnostic,
    options.detector,
  );

  let benchmark: Awaited<ReturnType<typeof runStreamingAnnotatedBenchmark>>;
  let confidence: BenchmarkConfidenceAnalysis | undefined;

  if (confidenceOptions) {
    const result = await runStreamingAnnotatedBenchmarkWithConfidenceSweep(
      built.detector,
      sequence,
      provider,
      {
        ...(confidenceOptions.operatingConfidenceThreshold === undefined
          ? {}
          : { operatingConfidenceThreshold: confidenceOptions.operatingConfidenceThreshold }),
        ...(confidenceOptions.sweepThresholds === undefined
          ? {}
          : { sweepThresholds: confidenceOptions.sweepThresholds }),
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
    benchmark = result.benchmark;
    confidence = {
      operatingConfidenceThreshold: result.operatingConfidenceThreshold,
      sweep: result.confidenceSweep,
    };
  } else {
    benchmark = await runStreamingAnnotatedBenchmark(
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
  }

  const report = createDetectorBenchmarkReport({
    runId: options.runId,
    ...(options.createdAtIso === undefined ? {} : { createdAtIso: options.createdAtIso }),
    corpus: corpusFromSequence(sequence, options.corpusHashes),
    device: { ...options.device },
    benchmark,
    ...(confidence === undefined ? {} : { confidence }),
    notes: [
      `external_candidate:${candidate.id}`,
      'Checkpoint executed from externally supplied verified bytes; not bundled by Konta2r.',
      ...(options.corpusHashes?.annotationSha256 === undefined
        ? []
        : ['annotation_sha256_source:externally_computed_file_bytes']),
      ...(options.corpusHashes?.mediaSha256 === undefined
        ? []
        : ['media_sha256_source:externally_computed_file_bytes']),
      ...(confidence === undefined
        ? []
        : [
            `operating_confidence_threshold:${confidence.operatingConfidenceThreshold}`,
            `confidence_sweep_floor:${confidence.sweep.thresholds[0] ?? 'none'}`,
            `confidence_sweep_points:${confidence.sweep.thresholds.length}`,
          ]),
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
