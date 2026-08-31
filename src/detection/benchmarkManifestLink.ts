import {
  validateCorpusManifest,
  type CorpusManifest,
  type CorpusSplit,
} from './corpusManifest';

export interface BenchmarkManifestIdentity {
  corpusId: string;
  sha256: string;
  split: CorpusSplit;
}

export interface BenchmarkManifestLinkInput {
  manifestSha256: string;
  sequenceId: string;
  annotationSha256: string;
  mediaSha256?: string;
}

function sha256(value: string, label: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new Error(`${label} must be a SHA-256 hex digest`);
  return normalized;
}

/**
 * Verify that the exact annotation/media bytes used by a benchmark are the
 * sequence frozen in a specific corpus manifest. The returned identity omits
 * siteId and other location metadata; reports only need corpus/split identity.
 */
export function createBenchmarkManifestIdentity(
  manifest: CorpusManifest,
  input: BenchmarkManifestLinkInput,
): BenchmarkManifestIdentity {
  validateCorpusManifest(manifest);
  const manifestSha256 = sha256(input.manifestSha256, 'manifestSha256');
  const annotationSha256 = sha256(input.annotationSha256, 'annotationSha256');
  const mediaSha256 = input.mediaSha256 === undefined ? undefined : sha256(input.mediaSha256, 'mediaSha256');
  const sequence = manifest.sequences.find((value) => value.sequenceId === input.sequenceId);
  if (!sequence) throw new Error(`Sequence ${input.sequenceId} is not present in corpus manifest ${manifest.corpusId}`);
  if (sequence.annotationSha256.toLowerCase() !== annotationSha256) {
    throw new Error(`Annotation SHA-256 does not match corpus manifest entry ${input.sequenceId}`);
  }
  const expectedMedia = sequence.mediaSha256?.toLowerCase();
  if (expectedMedia !== mediaSha256) {
    throw new Error(`Media SHA-256 does not match corpus manifest entry ${input.sequenceId}`);
  }
  return {
    corpusId: manifest.corpusId,
    sha256: manifestSha256,
    split: sequence.split,
  };
}
