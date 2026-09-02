import {
  validateAnnotatedBenchmarkSequence,
  type AnnotatedBenchmarkFrame,
  type AnnotatedBenchmarkSequence,
  type BenchmarkFrameSelection,
  type GroundTruthObject,
  type GroundTruthOcclusion,
} from './benchmarkDataset';
import type { TemporalSamplingPlan } from './temporalSampling';

export type { AnnotatedBenchmarkSequence } from './benchmarkDataset';

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
  const number = finiteNumber(value, label);
  if (!Number.isInteger(number) || number < 0) throw new Error(`${label} must be a non-negative integer`);
  return number;
}

function positiveInteger(value: unknown, label: string): number {
  const number = finiteNumber(value, label);
  if (!Number.isInteger(number) || number < 1) throw new Error(`${label} must be a positive integer`);
  return number;
}

function optionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new Error(`${label} must be boolean`);
  return value;
}

function optionalOcclusion(value: unknown, label: string): GroundTruthOcclusion | undefined {
  if (value === undefined) return undefined;
  if (value === 'none' || value === 'partial' || value === 'heavy') return value;
  throw new Error(`${label} must be none, partial or heavy`);
}

function optionalHash(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  const hash = nonEmptyString(value, label).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error(`${label} must be a SHA-256 hex digest`);
  return hash;
}

function parseNumberArray(value: unknown, label: string): number[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((item, index) => finiteNumber(item, `${label}[${index}]`));
}

function parseSamplingPlan(value: unknown): TemporalSamplingPlan {
  const record = objectValue(value, 'sequence.samplingPlan');
  if (record.schemaVersion !== '1') throw new Error('sequence.samplingPlan.schemaVersion must be 1');
  if (record.strategy !== 'stratified_uniform_jitter') {
    throw new Error('sequence.samplingPlan.strategy is unsupported');
  }
  return {
    schemaVersion: '1',
    strategy: 'stratified_uniform_jitter',
    durationMs: finiteNumber(record.durationMs, 'sequence.samplingPlan.durationMs'),
    sampleCount: positiveInteger(record.sampleCount, 'sequence.samplingPlan.sampleCount'),
    seed: nonEmptyString(record.seed, 'sequence.samplingPlan.seed'),
    startMarginMs: finiteNumber(record.startMarginMs, 'sequence.samplingPlan.startMarginMs'),
    endMarginMs: finiteNumber(record.endMarginMs, 'sequence.samplingPlan.endMarginMs'),
    jitterFraction: finiteNumber(record.jitterFraction, 'sequence.samplingPlan.jitterFraction'),
    plannedMediaTimesMs: parseNumberArray(record.plannedMediaTimesMs, 'sequence.samplingPlan.plannedMediaTimesMs'),
  };
}

function parseSelection(value: unknown, frameIndex: number): BenchmarkFrameSelection {
  const label = `frames[${frameIndex}].selection`;
  const record = objectValue(value, label);
  if (record.source === 'manual') {
    if (record.planIndex !== undefined || record.requestedMediaTimeMs !== undefined) {
      throw new Error(`${label} manual source cannot contain planned fields`);
    }
    return { source: 'manual' };
  }
  if (record.source !== 'planned') throw new Error(`${label}.source must be planned or manual`);
  return {
    source: 'planned',
    planIndex: nonNegativeInteger(record.planIndex, `${label}.planIndex`),
    requestedMediaTimeMs: finiteNumber(record.requestedMediaTimeMs, `${label}.requestedMediaTimeMs`),
  };
}

function parseObject(value: unknown, frameIndex: number, objectIndex: number): GroundTruthObject {
  const label = `frames[${frameIndex}].objects[${objectIndex}]`;
  const record = objectValue(value, label);
  const bbox = objectValue(record.bbox, `${label}.bbox`);
  const object: GroundTruthObject = {
    annotationId: nonEmptyString(record.annotationId, `${label}.annotationId`),
    className: nonEmptyString(record.className, `${label}.className`),
    bbox: {
      x: finiteNumber(bbox.x, `${label}.bbox.x`),
      y: finiteNumber(bbox.y, `${label}.bbox.y`),
      width: finiteNumber(bbox.width, `${label}.bbox.width`),
      height: finiteNumber(bbox.height, `${label}.bbox.height`),
    },
  };
  const occlusion = optionalOcclusion(record.occlusion, `${label}.occlusion`);
  const ignore = optionalBoolean(record.ignore, `${label}.ignore`);
  if (occlusion !== undefined) object.occlusion = occlusion;
  if (ignore !== undefined) object.ignore = ignore;
  return object;
}

function parseFrame(value: unknown, index: number): AnnotatedBenchmarkFrame {
  const label = `frames[${index}]`;
  const record = objectValue(value, label);
  if (!Array.isArray(record.objects)) throw new Error(`${label}.objects must be an array`);
  const frame: AnnotatedBenchmarkFrame = {
    frameId: nonEmptyString(record.frameId, `${label}.frameId`),
    timestampMs: finiteNumber(record.timestampMs, `${label}.timestampMs`),
    width: finiteNumber(record.width, `${label}.width`),
    height: finiteNumber(record.height, `${label}.height`),
    objects: record.objects.map((object, objectIndex) => parseObject(object, index, objectIndex)),
  };
  if (record.mediaTimeMs !== undefined) {
    frame.mediaTimeMs = finiteNumber(record.mediaTimeMs, `${label}.mediaTimeMs`);
  }
  if (record.selection !== undefined) frame.selection = parseSelection(record.selection, index);
  return frame;
}

/** Parse a benchmark sequence JSON file as untrusted local input, then run the
 * same semantic validation used by the benchmark engine.
 */
export function parseAnnotatedBenchmarkSequenceJson(text: string): AnnotatedBenchmarkSequence {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new Error('Annotation file is not valid JSON');
  }
  const record = objectValue(value, 'sequence');
  if (record.schemaVersion !== '1') throw new Error('sequence.schemaVersion must be 1');
  if (!Array.isArray(record.frames)) throw new Error('sequence.frames must be an array');

  const sequence: AnnotatedBenchmarkSequence = {
    schemaVersion: '1',
    datasetId: nonEmptyString(record.datasetId, 'sequence.datasetId'),
    sequenceId: nonEmptyString(record.sequenceId, 'sequence.sequenceId'),
    frames: record.frames.map((frame, index) => parseFrame(frame, index)),
  };

  if (record.samplingPlan !== undefined) sequence.samplingPlan = parseSamplingPlan(record.samplingPlan);

  if (record.source !== undefined) {
    const source = objectValue(record.source, 'sequence.source');
    const mediaSha256 = optionalHash(source.mediaSha256, 'sequence.source.mediaSha256');
    const annotationSha256 = optionalHash(source.annotationSha256, 'sequence.source.annotationSha256');
    const note = source.note === undefined ? undefined : nonEmptyString(source.note, 'sequence.source.note');
    sequence.source = {
      ...(mediaSha256 === undefined ? {} : { mediaSha256 }),
      ...(annotationSha256 === undefined ? {} : { annotationSha256 }),
      ...(note === undefined ? {} : { note }),
    };
  }

  validateAnnotatedBenchmarkSequence(sequence);
  return sequence;
}
