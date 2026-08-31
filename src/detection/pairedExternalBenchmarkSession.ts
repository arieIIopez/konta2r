import type { AnnotatedBenchmarkSequence } from './benchmarkDataset';
import {
  runExternalCandidateBenchmarkSession,
  type ExternalBenchmarkSessionOptions,
  type ExternalBenchmarkSessionResult,
} from './externalBenchmarkSession';
import type { DetectorCandidateRecord } from './modelCandidates';
import {
  comparePairedDetectorBenchmarkReports,
  type PairedDetectorBenchmarkComparison,
} from './pairedBenchmarkComparison';
import type {
  ExternalCandidateDetectorFactoryOptions,
} from './onnx/externalCandidateDetectorFactory';
import type { VerifiedOnnxArtifact } from './onnx/modelArtifact';
import type { OnnxCandidateProbeDiagnosticRecord } from './onnx/probeDiagnostic';
import type { BenchmarkFrameProvider } from './streamingBenchmark';

export interface PairedExternalBenchmarkCandidate {
  candidate: DetectorCandidateRecord;
  artifact: VerifiedOnnxArtifact;
  diagnostic: OnnxCandidateProbeDiagnosticRecord;
  /** Family-specific pixel-preparation hooks only; scientific thresholds remain common. */
  detectorHooks?: Pick<
    ExternalCandidateDetectorFactoryOptions,
    'ssdRgbResize' | 'nanodetRgbLetterbox'
  >;
}

export type PairedCommonDetectorOptions = Omit<
  ExternalCandidateDetectorFactoryOptions,
  'ssdRgbResize' | 'nanodetRgbLetterbox'
>;

export interface PairedExternalBenchmarkSessionOptions extends Omit<
  ExternalBenchmarkSessionOptions,
  'runId' | 'detector'
> {
  comparisonId: string;
  leftRunId: string;
  rightRunId: string;
  detector?: PairedCommonDetectorOptions;
}

export interface PairedExternalBenchmarkSessionResult {
  schemaVersion: '1';
  left: ExternalBenchmarkSessionResult;
  right: ExternalBenchmarkSessionResult;
  comparison: PairedDetectorBenchmarkComparison;
}

function detectorOptions(
  common: PairedCommonDetectorOptions | undefined,
  candidate: PairedExternalBenchmarkCandidate,
): ExternalCandidateDetectorFactoryOptions {
  return {
    ...(common ?? {}),
    ...(candidate.detectorHooks?.ssdRgbResize === undefined
      ? {}
      : { ssdRgbResize: candidate.detectorHooks.ssdRgbResize }),
    ...(candidate.detectorHooks?.nanodetRgbLetterbox === undefined
      ? {}
      : { nanodetRgbLetterbox: candidate.detectorHooks.nanodetRgbLetterbox }),
  };
}

function sessionOptions(
  options: PairedExternalBenchmarkSessionOptions,
  runId: string,
  detector: ExternalCandidateDetectorFactoryOptions,
): ExternalBenchmarkSessionOptions {
  return {
    runId,
    ...(options.createdAtIso === undefined ? {} : { createdAtIso: options.createdAtIso }),
    device: { ...options.device },
    ...(options.notes === undefined ? {} : { notes: [...options.notes] }),
    ...(options.corpusHashes === undefined ? {} : { corpusHashes: { ...options.corpusHashes } }),
    ...(options.manifestIdentity === undefined
      ? {}
      : { manifestIdentity: { ...options.manifestIdentity } }),
    detector,
    ...(options.benchmark === undefined ? {} : { benchmark: { ...options.benchmark } }),
    ...(options.validity === undefined ? {} : { validity: { ...options.validity } }),
  };
}

/**
 * Runs two candidates sequentially against the exact same sequence, provider,
 * device identity and scientific policy. Candidate-specific differences are
 * limited to preprocessing hooks required by their codec family.
 */
export async function runPairedExternalCandidateBenchmarkSession(
  left: PairedExternalBenchmarkCandidate,
  right: PairedExternalBenchmarkCandidate,
  sequence: AnnotatedBenchmarkSequence,
  provider: BenchmarkFrameProvider,
  options: PairedExternalBenchmarkSessionOptions,
): Promise<PairedExternalBenchmarkSessionResult> {
  if (options.comparisonId.trim().length === 0) throw new Error('comparisonId is required');
  if (options.leftRunId.trim().length === 0 || options.rightRunId.trim().length === 0) {
    throw new Error('Both paired run ids are required');
  }
  if (left.candidate.id === right.candidate.id) {
    throw new Error('Paired benchmark requires two distinct candidate ids');
  }

  const leftResult = await runExternalCandidateBenchmarkSession(
    left.candidate,
    left.artifact,
    left.diagnostic,
    sequence,
    provider,
    sessionOptions(options, options.leftRunId, detectorOptions(options.detector, left)),
  );
  const rightResult = await runExternalCandidateBenchmarkSession(
    right.candidate,
    right.artifact,
    right.diagnostic,
    sequence,
    provider,
    sessionOptions(options, options.rightRunId, detectorOptions(options.detector, right)),
  );

  return {
    schemaVersion: '1',
    left: leftResult,
    right: rightResult,
    comparison: comparePairedDetectorBenchmarkReports(
      options.comparisonId,
      leftResult.report,
      rightResult.report,
    ),
  };
}
