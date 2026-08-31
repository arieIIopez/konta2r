import {
  CORPUS_DEVICE_PROFILES,
  CORPUS_LIGHTING,
  CORPUS_SCENE_TYPES,
  CORPUS_SPLITS,
  CORPUS_VIEW_ANGLES,
  validateCorpusManifest,
  type CorpusDeviceProfile,
  type CorpusLighting,
  type CorpusManifest,
  type CorpusManifestSequence,
  type CorpusSceneType,
  type CorpusSplit,
  type CorpusViewAngle,
} from './corpusManifest';

function recordValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  return stringValue(value, label);
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  const candidate = stringValue(value, label);
  if (!allowed.includes(candidate as T)) throw new Error(`${label} has unsupported value ${candidate}`);
  return candidate as T;
}

function stringArray(value: unknown, label: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((item, index) => stringValue(item, `${label}[${index}]`));
}

function parseSequence(value: unknown, index: number): CorpusManifestSequence {
  const label = `sequences[${index}]`;
  const record = recordValue(value, label);
  const mediaSha256 = optionalString(record.mediaSha256, `${label}.mediaSha256`);
  const deviceProfile = record.deviceProfile === undefined
    ? undefined
    : enumValue<CorpusDeviceProfile>(record.deviceProfile, CORPUS_DEVICE_PROFILES, `${label}.deviceProfile`);
  const tags = stringArray(record.tags, `${label}.tags`);
  const note = optionalString(record.note, `${label}.note`);

  return {
    sequenceId: stringValue(record.sequenceId, `${label}.sequenceId`),
    annotationSha256: stringValue(record.annotationSha256, `${label}.annotationSha256`),
    ...(mediaSha256 === undefined ? {} : { mediaSha256 }),
    split: enumValue<CorpusSplit>(record.split, CORPUS_SPLITS, `${label}.split`),
    siteId: stringValue(record.siteId, `${label}.siteId`),
    sceneType: enumValue<CorpusSceneType>(record.sceneType, CORPUS_SCENE_TYPES, `${label}.sceneType`),
    lighting: enumValue<CorpusLighting>(record.lighting, CORPUS_LIGHTING, `${label}.lighting`),
    viewAngle: enumValue<CorpusViewAngle>(record.viewAngle, CORPUS_VIEW_ANGLES, `${label}.viewAngle`),
    ...(deviceProfile === undefined ? {} : { deviceProfile }),
    ...(tags === undefined ? {} : { tags }),
    ...(note === undefined ? {} : { note }),
  };
}

/** Parse a corpus manifest as untrusted local input and then run the same
 * semantic validation used by coverage/benchmark tooling. */
export function parseCorpusManifestJson(text: string): CorpusManifest {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new Error('Corpus manifest is not valid JSON');
  }
  const record = recordValue(value, 'manifest');
  if (record.schemaVersion !== '1') throw new Error('manifest.schemaVersion must be 1');
  if (!Array.isArray(record.sequences)) throw new Error('manifest.sequences must be an array');
  const note = optionalString(record.note, 'manifest.note');

  const manifest: CorpusManifest = {
    schemaVersion: '1',
    corpusId: stringValue(record.corpusId, 'manifest.corpusId'),
    createdAtIso: stringValue(record.createdAtIso, 'manifest.createdAtIso'),
    sequences: record.sequences.map((sequence, index) => parseSequence(sequence, index)),
    ...(note === undefined ? {} : { note }),
  };
  validateCorpusManifest(manifest);
  return manifest;
}
