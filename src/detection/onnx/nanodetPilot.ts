import evidenceText from '../../../docs/benchmarks/evidence/opencv-nanodet-m-plus-1.5x-416-2022nov-probe.json?raw';
import { OPENCV_NANODET_M_PLUS_1_5X_416 } from '../modelCandidates';
import type { Detector } from '../types';
import {
  buildExternalCandidateDetector,
  type ExternalCandidateDetectorFactoryOptions,
} from './externalCandidateDetectorFactory';
import {
  fetchVerifiedOnnxArtifact,
  type ArtifactFetcher,
  type Sha256Digest,
} from './modelArtifact';
import { reviewImportedProbeDiagnostic } from './probeDiagnosticReview';
import {
  IndexedDbVerifiedOnnxArtifactCache,
  type VerifiedOnnxArtifactCache,
} from './artifactCache';

export type NanoDetPilotArtifactSource = 'cache' | 'network';

export interface NanoDetPilotLoaderOptions extends ExternalCandidateDetectorFactoryOptions {
  cache?: VerifiedOnnxArtifactCache;
  fetcher?: ArtifactFetcher;
  digest?: Sha256Digest;
}

export interface NanoDetPilotLoadResult {
  detector: Detector;
  candidateId: string;
  modelSha256: string;
  artifactSource: NanoDetPilotArtifactSource;
  cachePersisted: boolean;
  redistributionVerified: false;
}

/**
 * Loads the technically verified NanoDet candidate for explicit field testing.
 * The checkpoint remains external: Konta2r downloads it from the registered
 * upstream URL, verifies its SHA-256, optionally caches the verified bytes on
 * the device and constructs the existing experimental detector adapter.
 *
 * This is intentionally NOT a production-selection function. The candidate's
 * weights redistribution gate remains false until the separate license review
 * and representative benchmark are complete.
 */
export async function loadNanoDetPilot(
  options: NanoDetPilotLoaderOptions = {},
): Promise<NanoDetPilotLoadResult> {
  const candidate = OPENCV_NANODET_M_PLUS_1_5X_416;
  if (candidate.status !== 'probe_verified') {
    throw new Error('NanoDet pilot requires a probe-verified candidate');
  }
  if (candidate.artifact.redistributionVerified) {
    throw new Error('NanoDet pilot contract expects an external non-bundled checkpoint');
  }

  const review = reviewImportedProbeDiagnostic(evidenceText);
  if (review.candidate.id !== candidate.id || review.verification.status !== 'verified') {
    throw new Error('Committed NanoDet diagnostic is not verified for the registered candidate');
  }

  const cache = options.cache ?? new IndexedDbVerifiedOnnxArtifactCache();
  let artifact = await cache.get(candidate.artifact.sha256);
  let artifactSource: NanoDetPilotArtifactSource = 'cache';
  let cachePersisted = artifact !== undefined;

  if (!artifact) {
    artifactSource = 'network';
    artifact = await fetchVerifiedOnnxArtifact(
      candidate.artifact.url,
      candidate.artifact.sha256,
      {
        ...(options.fetcher === undefined ? {} : { fetcher: options.fetcher }),
        ...(options.digest === undefined ? {} : { digest: options.digest }),
      },
    );
    try {
      await cache.put(artifact, candidate.artifact.url);
      cachePersisted = true;
    } catch {
      // Cache persistence is a reliability optimization. A verified in-memory
      // artifact remains safe to execute when storage quota/persistence fails.
      cachePersisted = false;
    }
  }

  const built = buildExternalCandidateDetector(
    candidate,
    artifact,
    review.diagnostic,
    {
      ...(options.minConfidence === undefined ? {} : { minConfidence: options.minConfidence }),
      ...(options.maxDetections === undefined ? {} : { maxDetections: options.maxDetections }),
      ...(options.capabilities === undefined ? {} : { capabilities: options.capabilities }),
      ...(options.sessionFactory === undefined ? {} : { sessionFactory: options.sessionFactory }),
      ...(options.preferWebGpu === undefined ? {} : { preferWebGpu: options.preferWebGpu }),
      ...(options.nanodetRgbLetterbox === undefined
        ? {}
        : { nanodetRgbLetterbox: options.nanodetRgbLetterbox }),
    },
  );

  if (built.candidateId !== candidate.id || built.redistributionVerified) {
    await built.detector.dispose();
    throw new Error('NanoDet pilot factory returned an unexpected candidate contract');
  }

  return {
    detector: built.detector,
    candidateId: candidate.id,
    modelSha256: artifact.sha256,
    artifactSource,
    cachePersisted,
    redistributionVerified: false,
  };
}
