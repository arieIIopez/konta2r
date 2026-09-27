import { parseAnnotatedBenchmarkSequenceJson } from './benchmarkDatasetParser';
import {
  validateCorpusManifest,
  type CorpusDeviceProfile,
  type CorpusLighting,
  type CorpusManifest,
  type CorpusManifestSequence,
  type CorpusSceneType,
  type CorpusSplit,
  type CorpusViewAngle,
} from './corpusManifest';
import { hashLocalBenchmarkBlob, type LocalFileHashOptions } from './localBenchmarkFiles';

export interface LocalManifestSequenceMetadata {
  split: CorpusSplit;
  siteId: string;
  sceneType: CorpusSceneType;
  lighting: CorpusLighting;
  viewAngle: CorpusViewAngle;
  deviceProfile?: CorpusDeviceProfile;
  tags?: string[];
  note?: string;
}

export interface LocalManifestSequenceFiles {
  annotationBlob: Blob;
  mediaBlob?: Blob;
}

export interface LocalManifestSequenceHashProgress {
  phase: 'annotation' | 'media';
  processedBytes: number;
  totalBytes: number;
}

export interface PrepareLocalManifestSequenceOptions {
  onProgress?: (progress: LocalManifestSequenceHashProgress) => void;
  chunkSizeBytes?: number;
}

function hashOptions(
  phase: LocalManifestSequenceHashProgress['phase'],
  options: PrepareLocalManifestSequenceOptions,
): LocalFileHashOptions {
  return {
    ...(options.chunkSizeBytes === undefined ? {} : { chunkSizeBytes: options.chunkSizeBytes }),
    ...(options.onProgress === undefined
      ? {}
      : {
          onProgress: (progress) => options.onProgress?.({
            phase,
            processedBytes: progress.processedBytes,
            totalBytes: progress.totalBytes,
          }),
        }),
  };
}

/**
 * Prepare one manifest entry from local bytes. The annotation sequenceId is the
 * source of truth; callers do not type the identifier a second time.
 *
 * If the annotations already declare source.mediaSha256, a local media file is
 * required and must reproduce that hash. This prevents silently pairing ground
 * truth with a different video.
 */
export async function prepareLocalCorpusManifestSequence(
  files: LocalManifestSequenceFiles,
  metadata: LocalManifestSequenceMetadata,
  options: PrepareLocalManifestSequenceOptions = {},
): Promise<CorpusManifestSequence> {
  if (files.annotationBlob.size <= 0) throw new Error('Annotation file is empty');
  const annotationText = await files.annotationBlob.text();
  const annotations = parseAnnotatedBenchmarkSequenceJson(annotationText);

  const annotationSha256 = await hashLocalBenchmarkBlob(
    files.annotationBlob,
    hashOptions('annotation', options),
  );

  let mediaSha256: string | undefined;
  if (files.mediaBlob !== undefined) {
    if (files.mediaBlob.size <= 0) throw new Error('Media file is empty');
    mediaSha256 = await hashLocalBenchmarkBlob(files.mediaBlob, hashOptions('media', options));
    const declared = annotations.source?.mediaSha256?.toLowerCase();
    if (declared !== undefined && declared !== mediaSha256) {
      throw new Error(`Selected media SHA-256 does not match annotations: expected ${declared}, received ${mediaSha256}`);
    }
  } else if (annotations.source?.mediaSha256 !== undefined) {
    throw new Error('Annotations declare source.mediaSha256; select the corresponding local media file to verify it');
  }

  return {
    sequenceId: annotations.sequenceId,
    annotationSha256,
    ...(mediaSha256 === undefined ? {} : { mediaSha256 }),
    split: metadata.split,
    siteId: metadata.siteId,
    sceneType: metadata.sceneType,
    lighting: metadata.lighting,
    viewAngle: metadata.viewAngle,
    ...(metadata.deviceProfile === undefined ? {} : { deviceProfile: metadata.deviceProfile }),
    ...(metadata.tags === undefined ? {} : { tags: [...metadata.tags] }),
    ...(metadata.note === undefined ? {} : { note: metadata.note }),
  };
}

export function createCorpusManifest(
  corpusId: string,
  sequences: CorpusManifestSequence[],
  createdAtIso = new Date().toISOString(),
  note?: string,
): CorpusManifest {
  const manifest: CorpusManifest = {
    schemaVersion: '1',
    corpusId,
    createdAtIso,
    sequences: sequences.map((sequence) => ({
      ...sequence,
      ...(sequence.tags === undefined ? {} : { tags: [...sequence.tags] }),
    })),
    ...(note === undefined ? {} : { note }),
  };
  validateCorpusManifest(manifest);
  return manifest;
}

export function serializeCorpusManifest(manifest: CorpusManifest): string {
  validateCorpusManifest(manifest);
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
