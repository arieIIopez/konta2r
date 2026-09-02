import type { BoundingBox } from '../core/types';
import {
  validateAnnotatedBenchmarkSequence,
  validateGroundTruthObject,
  type AnnotatedBenchmarkFrame,
  type AnnotatedBenchmarkSequence,
  type BenchmarkFrameSelection,
  type GroundTruthObject,
  type GroundTruthOcclusion,
} from './benchmarkDataset';
import {
  validateTemporalSamplingPlan,
  type TemporalSamplingPlan,
} from './temporalSampling';

export const DETECTOR_GROUND_TRUTH_CLASSES = [
  'person',
  'bicycle',
  'motorcycle',
  'car',
  'bus',
  'truck',
] as const;

export type DetectorGroundTruthClass = typeof DETECTOR_GROUND_TRUTH_CLASSES[number];

export interface AnnotationDraft {
  datasetId: string;
  sequenceId: string;
  frames: AnnotatedBenchmarkFrame[];
  samplingPlan?: TemporalSamplingPlan;
  nextFrameOrdinal: number;
  nextAnnotationOrdinal: number;
}

export interface AddAnnotationFrameInput {
  mediaTimeMs: number;
  width: number;
  height: number;
  /** Logical detector timestamp; defaults to mediaTimeMs for this annotation surface. */
  timestampMs?: number;
  selection?: BenchmarkFrameSelection;
}

export interface AddGroundTruthObjectInput {
  className: DetectorGroundTruthClass;
  bbox: BoundingBox;
  occlusion?: GroundTruthOcclusion;
  ignore?: boolean;
}

function nonEmpty(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error(`${label} is required`);
  return normalized;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} must be a positive integer`);
  return value;
}

function nextId(prefix: string, ordinal: number): string {
  return `${prefix}-${String(ordinal).padStart(4, '0')}`;
}

function cloneObject(object: GroundTruthObject): GroundTruthObject {
  return {
    ...object,
    bbox: { ...object.bbox },
  };
}

function cloneSelection(selection: BenchmarkFrameSelection): BenchmarkFrameSelection {
  return { ...selection };
}

function cloneFrame(frame: AnnotatedBenchmarkFrame): AnnotatedBenchmarkFrame {
  return {
    ...frame,
    ...(frame.selection === undefined ? {} : { selection: cloneSelection(frame.selection) }),
    objects: frame.objects.map(cloneObject),
  };
}

function cloneSamplingPlan(plan: TemporalSamplingPlan): TemporalSamplingPlan {
  return { ...plan, plannedMediaTimesMs: [...plan.plannedMediaTimesMs] };
}

function sortFrames(frames: AnnotatedBenchmarkFrame[]): void {
  frames.sort((a, b) => {
    const aTime = a.mediaTimeMs ?? a.timestampMs;
    const bTime = b.mediaTimeMs ?? b.timestampMs;
    return aTime - bTime || a.frameId.localeCompare(b.frameId);
  });
}

export function createAnnotationDraft(datasetId: string, sequenceId: string): AnnotationDraft {
  return {
    datasetId: nonEmpty(datasetId, 'datasetId'),
    sequenceId: nonEmpty(sequenceId, 'sequenceId'),
    frames: [],
    nextFrameOrdinal: 1,
    nextAnnotationOrdinal: 1,
  };
}

export function cloneAnnotationDraft(draft: AnnotationDraft): AnnotationDraft {
  return {
    datasetId: draft.datasetId,
    sequenceId: draft.sequenceId,
    frames: draft.frames.map(cloneFrame),
    ...(draft.samplingPlan === undefined ? {} : { samplingPlan: cloneSamplingPlan(draft.samplingPlan) }),
    nextFrameOrdinal: draft.nextFrameOrdinal,
    nextAnnotationOrdinal: draft.nextAnnotationOrdinal,
  };
}

export function setAnnotationSamplingPlan(draft: AnnotationDraft, plan: TemporalSamplingPlan | undefined): void {
  if (plan === undefined) {
    if (draft.frames.some((frame) => frame.selection?.source === 'planned')) {
      throw new Error('Cannot remove sampling plan while planned frames remain in the draft');
    }
    delete draft.samplingPlan;
    return;
  }
  validateTemporalSamplingPlan(plan);
  const existingPlannedFrames = draft.frames.filter((frame) => frame.selection?.source === 'planned');
  for (const frame of existingPlannedFrames) {
    const index = frame.selection?.planIndex;
    const requested = frame.selection?.requestedMediaTimeMs;
    const expected = index === undefined ? undefined : plan.plannedMediaTimesMs[index];
    if (expected === undefined || requested === undefined || Math.abs(expected - requested) > 1e-9) {
      throw new Error('New sampling plan is incompatible with already captured planned frames');
    }
  }
  draft.samplingPlan = cloneSamplingPlan(plan);
}

export function addAnnotationFrame(
  draft: AnnotationDraft,
  input: AddAnnotationFrameInput,
): AnnotatedBenchmarkFrame {
  if (!Number.isFinite(input.mediaTimeMs) || input.mediaTimeMs < 0) {
    throw new Error('mediaTimeMs must be finite and non-negative');
  }
  if (!Number.isFinite(input.width) || input.width <= 0 || !Number.isFinite(input.height) || input.height <= 0) {
    throw new Error('Frame dimensions must be finite and greater than zero');
  }
  const timestampMs = input.timestampMs ?? input.mediaTimeMs;
  if (!Number.isFinite(timestampMs)) throw new Error('timestampMs must be finite');

  const duplicate = draft.frames.find((frame) => frame.mediaTimeMs === input.mediaTimeMs);
  if (duplicate) {
    if (input.selection?.source === 'planned' && duplicate.selection?.source !== 'planned') {
      duplicate.selection = cloneSelection(input.selection);
    }
    return duplicate;
  }

  const frame: AnnotatedBenchmarkFrame = {
    frameId: nextId('frame', draft.nextFrameOrdinal),
    timestampMs,
    mediaTimeMs: input.mediaTimeMs,
    ...(input.selection === undefined ? {} : { selection: cloneSelection(input.selection) }),
    width: input.width,
    height: input.height,
    objects: [],
  };
  draft.nextFrameOrdinal += 1;
  draft.frames.push(frame);
  sortFrames(draft.frames);
  return frame;
}

export function removeAnnotationFrame(draft: AnnotationDraft, frameId: string): boolean {
  const index = draft.frames.findIndex((frame) => frame.frameId === frameId);
  if (index < 0) return false;
  draft.frames.splice(index, 1);
  return true;
}

export function addGroundTruthObject(
  draft: AnnotationDraft,
  frameId: string,
  input: AddGroundTruthObjectInput,
): GroundTruthObject {
  if (!DETECTOR_GROUND_TRUTH_CLASSES.includes(input.className)) {
    throw new Error(`Unsupported detector ground-truth class ${input.className}`);
  }
  const frame = draft.frames.find((value) => value.frameId === frameId);
  if (!frame) throw new Error(`Unknown annotation frame ${frameId}`);
  const object: GroundTruthObject = {
    annotationId: nextId('annotation', draft.nextAnnotationOrdinal),
    className: input.className,
    bbox: { ...input.bbox },
    ...(input.occlusion === undefined ? {} : { occlusion: input.occlusion }),
    ...(input.ignore === undefined ? {} : { ignore: input.ignore }),
  };
  validateGroundTruthObject(object, frame.width, frame.height);
  draft.nextAnnotationOrdinal += 1;
  frame.objects.push(object);
  return object;
}

export function removeGroundTruthObject(
  draft: AnnotationDraft,
  frameId: string,
  annotationId: string,
): boolean {
  const frame = draft.frames.find((value) => value.frameId === frameId);
  if (!frame) return false;
  const index = frame.objects.findIndex((object) => object.annotationId === annotationId);
  if (index < 0) return false;
  frame.objects.splice(index, 1);
  return true;
}

export function toAnnotatedBenchmarkSequence(draft: AnnotationDraft): AnnotatedBenchmarkSequence {
  const sequence: AnnotatedBenchmarkSequence = {
    schemaVersion: '1',
    datasetId: nonEmpty(draft.datasetId, 'datasetId'),
    sequenceId: nonEmpty(draft.sequenceId, 'sequenceId'),
    frames: draft.frames.map(cloneFrame),
    ...(draft.samplingPlan === undefined ? {} : { samplingPlan: cloneSamplingPlan(draft.samplingPlan) }),
    source: {
      note: 'Created locally with Konta2r benchmark annotation surface. Logical timestampMs defaults to mediaTimeMs unless explicitly changed.',
    },
  };
  sortFrames(sequence.frames);
  validateAnnotatedBenchmarkSequence(sequence);
  return sequence;
}

export function serializeAnnotationDraft(draft: AnnotationDraft): string {
  return `${JSON.stringify(toAnnotatedBenchmarkSequence(draft), null, 2)}\n`;
}

export function restoreAnnotationDraft(sequence: AnnotatedBenchmarkSequence): AnnotationDraft {
  validateAnnotatedBenchmarkSequence(sequence);
  let maximumFrameOrdinal = 0;
  let maximumAnnotationOrdinal = 0;
  for (const frame of sequence.frames) {
    const frameMatch = /^frame-(\d+)$/.exec(frame.frameId);
    if (frameMatch?.[1]) maximumFrameOrdinal = Math.max(maximumFrameOrdinal, Number(frameMatch[1]));
    for (const object of frame.objects) {
      const annotationMatch = /^annotation-(\d+)$/.exec(object.annotationId);
      if (annotationMatch?.[1]) maximumAnnotationOrdinal = Math.max(maximumAnnotationOrdinal, Number(annotationMatch[1]));
    }
  }
  return {
    datasetId: sequence.datasetId,
    sequenceId: sequence.sequenceId,
    frames: sequence.frames.map(cloneFrame),
    ...(sequence.samplingPlan === undefined ? {} : { samplingPlan: cloneSamplingPlan(sequence.samplingPlan) }),
    nextFrameOrdinal: positiveInteger(maximumFrameOrdinal + 1, 'nextFrameOrdinal'),
    nextAnnotationOrdinal: positiveInteger(maximumAnnotationOrdinal + 1, 'nextAnnotationOrdinal'),
  };
}
