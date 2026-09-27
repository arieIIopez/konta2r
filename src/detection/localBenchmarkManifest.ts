import type { AnnotatedBenchmarkSequence } from './benchmarkDataset';
import { parseCorpusManifestJson } from './corpusManifestParser';
import {
  createBenchmarkManifestIdentity,
  type BenchmarkManifestIdentity,
} from './benchmarkManifestLink';
import { hashLocalBenchmarkBlob, type LocalFileHashOptions } from './localBenchmarkFiles';

export interface VerifyLocalBenchmarkManifestOptions extends LocalFileHashOptions {}

export interface LocalBenchmarkManifestVerification {
  identity: BenchmarkManifestIdentity;
  manifestSha256: string;
}

/**
 * Parse and hash the exact local manifest bytes, then prove that the benchmark
 * sequence and its frozen annotation/media bytes are the entry referenced by
 * that manifest. No site/location metadata is copied into the report identity.
 */
export async function verifyLocalBenchmarkManifest(
  manifestBlob: Blob,
  sequence: AnnotatedBenchmarkSequence,
  annotationSha256: string,
  mediaSha256: string | undefined,
  options: VerifyLocalBenchmarkManifestOptions = {},
): Promise<LocalBenchmarkManifestVerification> {
  if (manifestBlob.size <= 0) throw new Error('Corpus manifest file is empty');
  const manifestText = await manifestBlob.text();
  const manifest = parseCorpusManifestJson(manifestText);
  const manifestSha256 = await hashLocalBenchmarkBlob(manifestBlob, options);
  const identity = createBenchmarkManifestIdentity(manifest, {
    manifestSha256,
    sequenceId: sequence.sequenceId,
    annotationSha256,
    ...(mediaSha256 === undefined ? {} : { mediaSha256 }),
  });
  return { identity, manifestSha256 };
}

export function assertBenchmarkProfileMatchesManifestSplit(
  profile: 'development' | 'selection' | 'final_evaluation',
  identity: BenchmarkManifestIdentity | undefined,
): void {
  if (profile === 'development') return;
  if (!identity) throw new Error(`${profile} requires a verified corpus manifest`);
  if (profile === 'selection' && identity.split !== 'validation') {
    throw new Error(`selection requires validation split; manifest sequence is ${identity.split}`);
  }
  if (profile === 'final_evaluation' && identity.split !== 'held_out_test') {
    throw new Error(`final_evaluation requires held_out_test split; manifest sequence is ${identity.split}`);
  }
}
