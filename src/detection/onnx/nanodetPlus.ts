import * as ort from 'onnxruntime-web/webgpu';
import type { RawDetection } from '../../core/types';
import type { DetectorInput } from '../types';
import type { OnnxDetectorCodec, OnnxPreparedInput } from './codec';
import type { OnnxModelProbeResult } from './modelProbe';
import type { OnnxValueMap, OnnxValueMetadata } from './runtime';

export const NANODET_PLUS_MOBILITY_COCO_CLASS_MAP: Readonly<Record<number, string>> = {
  0: 'person',
  1: 'bicycle',
  2: 'car',
  3: 'motorcycle',
  5: 'bus',
  7: 'truck',
  15: 'cat',
  16: 'dog',
  36: 'skateboard',
};

const NANODET_INPUT_WIDTH = 416;
const NANODET_INPUT_HEIGHT = 416;
const NANODET_CLASS_COUNT = 80;
const NANODET_REG_MAX = 7;
const NANODET_REG_BINS = NANODET_REG_MAX + 1;
const NANODET_BBOX_CHANNELS = 4 * NANODET_REG_BINS;
const NANODET_MEAN = [103.53, 116.28, 123.675] as const;
const NANODET_STD = [57.375, 57.12, 58.395] as const;
const NANODET_EXPECTED_LEVELS = [
  { stride: 8, locations: 2704 },
  { stride: 16, locations: 676 },
  { stride: 32, locations: 169 },
] as const;

export interface NanoDetPlusLevelContract {
  stride: number;
  locations: number;
  classOutputName: string;
  bboxOutputName: string;
}

export interface NanoDetPlusContract {
  inputName: string;
  inputWidth: number;
  inputHeight: number;
  inputLayout: 'NCHW';
  classCount: number;
  regMax: number;
  levels: NanoDetPlusLevelContract[];
}

export interface NanoDetProbeAssessment {
  compatible: boolean;
  errors: string[];
  warnings: string[];
  contract?: NanoDetPlusContract;
}

export interface NanoDetLetterboxTransform {
  sourceWidth: number;
  sourceHeight: number;
  inputWidth: number;
  inputHeight: number;
  resizedWidth: number;
  resizedHeight: number;
  left: number;
  top: number;
}

export interface NanoDetLetterboxPixels {
  rgb: Uint8Array;
  transform: NanoDetLetterboxTransform;
}

export type NanoDetRgbLetterbox = (
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  inputWidth: number,
  inputHeight: number,
) => Promise<NanoDetLetterboxPixels> | NanoDetLetterboxPixels;

export interface NanoDetFrameContext {
  transform: NanoDetLetterboxTransform;
}

export interface NanoDetPlusCodecOptions {
  classMap?: Readonly<Record<number, string>>;
  letterboxRgb?: NanoDetRgbLetterbox;
  scoreThreshold?: number;
  iouThreshold?: number;
  nmsPre?: number;
}

interface TensorDataLike {
  readonly length: number;
  readonly [index: number]: number | bigint;
}

interface NanoDetCandidateBox {
  classId: number;
  confidence: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function exactNumericShape(
  shape: readonly (string | number)[] | undefined,
  expected: readonly number[],
): boolean {
  return shape !== undefined
    && shape.length === expected.length
    && shape.every((value, index) => typeof value === 'number' && value === expected[index]);
}

function normalizedTensorType(value: OnnxValueMetadata): string | undefined {
  return value.type?.trim().toLowerCase();
}

function isFloatTensor(value: OnnxValueMetadata): boolean {
  const type = normalizedTensorType(value);
  return value.kind === 'tensor' && (type === 'float32' || type === 'float');
}

function metadataForShape(
  outputs: readonly OnnxValueMetadata[],
  locations: number,
  channels: number,
): OnnxValueMetadata[] {
  return outputs.filter((value) => exactNumericShape(value.shape, [1, locations, channels]));
}

/**
 * Derives opaque output names from observed shapes instead of relying on the
 * numeric node names emitted by the 2022 PyTorch export. The real checkpoint
 * exposes three effective feature levels (52², 26², 13² => strides 8/16/32).
 */
export function assessNanoDetPlusProbeCompatibility(
  probe: OnnxModelProbeResult,
): NanoDetProbeAssessment {
  const errors: string[] = [];
  const warnings: string[] = [];

  const candidateInputs = probe.inputs.filter((value) =>
    isFloatTensor(value) && exactNumericShape(value.shape, [1, 3, NANODET_INPUT_HEIGHT, NANODET_INPUT_WIDTH]));
  if (candidateInputs.length !== 1) {
    errors.push(`input_expected_single_float32_nchw_416:${candidateInputs.length}`);
  }

  const levels: NanoDetPlusLevelContract[] = [];
  for (const expected of NANODET_EXPECTED_LEVELS) {
    const classHeads = metadataForShape(probe.outputs, expected.locations, NANODET_CLASS_COUNT)
      .filter(isFloatTensor);
    const bboxHeads = metadataForShape(probe.outputs, expected.locations, NANODET_BBOX_CHANNELS)
      .filter(isFloatTensor);
    if (classHeads.length !== 1) {
      errors.push(`class_head_${expected.stride}_expected_one:${classHeads.length}`);
    }
    if (bboxHeads.length !== 1) {
      errors.push(`bbox_head_${expected.stride}_expected_one:${bboxHeads.length}`);
    }
    const classHead = classHeads[0];
    const bboxHead = bboxHeads[0];
    if (classHead && bboxHead) {
      levels.push({
        stride: expected.stride,
        locations: expected.locations,
        classOutputName: classHead.name,
        bboxOutputName: bboxHead.name,
      });
    }
  }

  const recognizedNames = new Set(levels.flatMap((level) => [level.classOutputName, level.bboxOutputName]));
  const tensorOutputs = probe.outputs.filter((value) => value.kind === 'tensor');
  if (tensorOutputs.length !== 6) {
    errors.push(`output_count_expected_6:${tensorOutputs.length}`);
  }
  const unrecognized = tensorOutputs.filter((value) => !recognizedNames.has(value.name));
  if (unrecognized.length > 0) {
    warnings.push(`unrecognized_outputs:${unrecognized.map((value) => value.name).join('|')}`);
  }

  const input = candidateInputs[0];
  const compatible = errors.length === 0 && input !== undefined && levels.length === 3;
  return {
    compatible,
    errors,
    warnings,
    ...(compatible && input
      ? {
          contract: {
            inputName: input.name,
            inputWidth: NANODET_INPUT_WIDTH,
            inputHeight: NANODET_INPUT_HEIGHT,
            inputLayout: 'NCHW' as const,
            classCount: NANODET_CLASS_COUNT,
            regMax: NANODET_REG_MAX,
            levels,
          },
        }
      : {}),
  };
}

export function assertNanoDetPlusProbeCompatible(probe: OnnxModelProbeResult): NanoDetPlusContract {
  const assessment = assessNanoDetPlusProbeCompatibility(probe);
  if (!assessment.compatible || !assessment.contract) {
    throw new Error(`NanoDet Plus ONNX contract mismatch: ${assessment.errors.join(', ')}`);
  }
  return assessment.contract;
}

function assertPositiveDimension(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be greater than zero`);
}

/** Matches the integer rounding used by the original OpenCV Zoo 2022 demo. */
export function calculateNanoDetLetterboxTransform(
  sourceWidth: number,
  sourceHeight: number,
  inputWidth = NANODET_INPUT_WIDTH,
  inputHeight = NANODET_INPUT_HEIGHT,
): NanoDetLetterboxTransform {
  assertPositiveDimension(sourceWidth, 'sourceWidth');
  assertPositiveDimension(sourceHeight, 'sourceHeight');
  assertPositiveDimension(inputWidth, 'inputWidth');
  assertPositiveDimension(inputHeight, 'inputHeight');
  if (inputWidth !== inputHeight) throw new Error('NanoDet 2022 letterbox contract expects a square model input');

  let resizedWidth = inputWidth;
  let resizedHeight = inputHeight;
  let left = 0;
  let top = 0;

  if (sourceHeight !== sourceWidth) {
    const hwScale = sourceHeight / sourceWidth;
    if (hwScale > 1) {
      resizedHeight = inputHeight;
      resizedWidth = Math.floor(inputWidth / hwScale);
      left = Math.floor((inputWidth - resizedWidth) * 0.5);
    } else {
      resizedHeight = Math.floor(inputHeight * hwScale);
      resizedWidth = inputWidth;
      top = Math.floor((inputHeight - resizedHeight) * 0.5);
    }
  }

  return {
    sourceWidth,
    sourceHeight,
    inputWidth,
    inputHeight,
    resizedWidth,
    resizedHeight,
    left,
    top,
  };
}

interface ScratchCanvas {
  width: number;
  height: number;
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
}

function createScratchCanvas(width: number, height: number): ScratchCanvas {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Unable to create OffscreenCanvas 2D context for NanoDet preprocessing');
    return { width, height, context };
  }
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Unable to create canvas 2D context for NanoDet preprocessing');
    return { width, height, context };
  }
  throw new Error('Canvas 2D API is required for default NanoDet preprocessing');
}

function createDefaultRgbLetterbox(): NanoDetRgbLetterbox {
  let scratch: ScratchCanvas | null = null;
  return (source, sourceWidth, sourceHeight, inputWidth, inputHeight) => {
    if (!scratch || scratch.width !== inputWidth || scratch.height !== inputHeight) {
      scratch = createScratchCanvas(inputWidth, inputHeight);
    }
    const transform = calculateNanoDetLetterboxTransform(
      sourceWidth,
      sourceHeight,
      inputWidth,
      inputHeight,
    );
    scratch.context.clearRect(0, 0, inputWidth, inputHeight);
    scratch.context.imageSmoothingEnabled = true;
    scratch.context.drawImage(
      source,
      transform.left,
      transform.top,
      transform.resizedWidth,
      transform.resizedHeight,
    );
    const rgba = scratch.context.getImageData(0, 0, inputWidth, inputHeight).data;
    const rgb = new Uint8Array(inputWidth * inputHeight * 3);
    for (let sourceIndex = 0, targetIndex = 0; sourceIndex < rgba.length; sourceIndex += 4) {
      rgb[targetIndex] = rgba[sourceIndex] ?? 0;
      rgb[targetIndex + 1] = rgba[sourceIndex + 1] ?? 0;
      rgb[targetIndex + 2] = rgba[sourceIndex + 2] ?? 0;
      targetIndex += 3;
    }
    return { rgb, transform };
  };
}

function validateThreshold(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be within [0, 1]`);
  }
  return value;
}

function validateNmsPre(value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new Error('nmsPre must be zero or greater');
  return Math.floor(value);
}

function tensorData(outputs: OnnxValueMap, name: string): TensorDataLike {
  const value = outputs[name];
  if (!value || typeof value !== 'object' || !('data' in value)) {
    throw new Error(`Missing tensor data for ONNX output ${name}`);
  }
  const data = (value as { data?: unknown }).data;
  if (!data || typeof data !== 'object' || !('length' in data)) {
    throw new Error(`ONNX output ${name} does not expose array-like data`);
  }
  return data as TensorDataLike;
}

function numericAt(data: TensorDataLike, index: number): number {
  if (index < 0 || index >= data.length) return Number.NaN;
  return Number(data[index]);
}

function stableExpectedBin(data: TensorDataLike, offset: number): number {
  let maxLogit = Number.NEGATIVE_INFINITY;
  for (let bin = 0; bin < NANODET_REG_BINS; bin += 1) {
    maxLogit = Math.max(maxLogit, numericAt(data, offset + bin));
  }
  if (!Number.isFinite(maxLogit)) return Number.NaN;
  let denominator = 0;
  let numerator = 0;
  for (let bin = 0; bin < NANODET_REG_BINS; bin += 1) {
    const weight = Math.exp(numericAt(data, offset + bin) - maxLogit);
    denominator += weight;
    numerator += weight * bin;
  }
  return denominator > 0 ? numerator / denominator : Number.NaN;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function intersectionOverUnion(a: NanoDetCandidateBox, b: NanoDetCandidateBox): number {
  const x1 = Math.max(a.x1, b.x1);
  const y1 = Math.max(a.y1, b.y1);
  const x2 = Math.min(a.x2, b.x2);
  const y2 = Math.min(a.y2, b.y2);
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  if (intersection <= 0) return 0;
  const areaA = Math.max(0, a.x2 - a.x1) * Math.max(0, a.y2 - a.y1);
  const areaB = Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1);
  const union = areaA + areaB - intersection;
  return union > 0 ? intersection / union : 0;
}

function nmsClassAgnostic(
  boxes: NanoDetCandidateBox[],
  iouThreshold: number,
): NanoDetCandidateBox[] {
  const ordered = [...boxes].sort((a, b) => b.confidence - a.confidence);
  const kept: NanoDetCandidateBox[] = [];
  for (const candidate of ordered) {
    if (kept.some((selected) => intersectionOverUnion(candidate, selected) > iouThreshold)) continue;
    kept.push(candidate);
  }
  return kept;
}

function modelBoxToSource(
  candidate: NanoDetCandidateBox,
  transform: NanoDetLetterboxTransform,
): { x: number; y: number; width: number; height: number } {
  const ratioX = transform.sourceWidth / transform.resizedWidth;
  const ratioY = transform.sourceHeight / transform.resizedHeight;
  const x1 = clamp((candidate.x1 - transform.left) * ratioX, 0, transform.sourceWidth);
  const y1 = clamp((candidate.y1 - transform.top) * ratioY, 0, transform.sourceHeight);
  const x2 = clamp((candidate.x2 - transform.left) * ratioX, 0, transform.sourceWidth);
  const y2 = clamp((candidate.y2 - transform.top) * ratioY, 0, transform.sourceHeight);
  return {
    x: x1,
    y: y1,
    width: Math.max(0, x2 - x1),
    height: Math.max(0, y2 - y1),
  };
}

export class NanoDetPlusCodec implements OnnxDetectorCodec<NanoDetFrameContext> {
  private readonly contract: NanoDetPlusContract;
  private readonly classMap: Readonly<Record<number, string>>;
  private readonly letterboxRgb: NanoDetRgbLetterbox;
  private readonly scoreThreshold: number;
  private readonly iouThreshold: number;
  private readonly nmsPre: number;

  private constructor(contract: NanoDetPlusContract, options: NanoDetPlusCodecOptions) {
    this.contract = contract;
    this.classMap = options.classMap ?? NANODET_PLUS_MOBILITY_COCO_CLASS_MAP;
    this.letterboxRgb = options.letterboxRgb ?? createDefaultRgbLetterbox();
    this.scoreThreshold = validateThreshold(options.scoreThreshold ?? 0.35, 'scoreThreshold');
    this.iouThreshold = validateThreshold(options.iouThreshold ?? 0.6, 'iouThreshold');
    this.nmsPre = validateNmsPre(options.nmsPre ?? 1000);
  }

  static fromProbe(
    probe: OnnxModelProbeResult,
    options: NanoDetPlusCodecOptions = {},
  ): NanoDetPlusCodec {
    return new NanoDetPlusCodec(assertNanoDetPlusProbeCompatible(probe), options);
  }

  async prepare(input: DetectorInput): Promise<OnnxPreparedInput<NanoDetFrameContext>> {
    const prepared = await this.letterboxRgb(
      input.source,
      input.sourceWidth,
      input.sourceHeight,
      this.contract.inputWidth,
      this.contract.inputHeight,
    );
    const expectedLength = this.contract.inputWidth * this.contract.inputHeight * 3;
    if (prepared.rgb.length !== expectedLength) {
      throw new Error(`NanoDet RGB letterbox returned ${prepared.rgb.length} bytes; expected ${expectedLength}`);
    }

    const planeSize = this.contract.inputWidth * this.contract.inputHeight;
    const nchw = new Float32Array(planeSize * 3);
    for (let pixel = 0; pixel < planeSize; pixel += 1) {
      const rgbOffset = pixel * 3;
      nchw[pixel] = ((prepared.rgb[rgbOffset] ?? 0) - NANODET_MEAN[0]) / NANODET_STD[0];
      nchw[planeSize + pixel] = ((prepared.rgb[rgbOffset + 1] ?? 0) - NANODET_MEAN[1]) / NANODET_STD[1];
      nchw[(2 * planeSize) + pixel] = ((prepared.rgb[rgbOffset + 2] ?? 0) - NANODET_MEAN[2]) / NANODET_STD[2];
    }

    const tensor = new ort.Tensor('float32', nchw, [
      1,
      3,
      this.contract.inputHeight,
      this.contract.inputWidth,
    ]);
    return {
      feeds: { [this.contract.inputName]: tensor },
      context: { transform: { ...prepared.transform } },
      dispose: () => tensor.dispose(),
    };
  }

  decode(outputs: OnnxValueMap, context: NanoDetFrameContext): RawDetection[] {
    const decoded: NanoDetCandidateBox[] = [];

    for (const level of this.contract.levels) {
      const classScores = tensorData(outputs, level.classOutputName);
      const bboxPredictions = tensorData(outputs, level.bboxOutputName);
      const expectedClassLength = level.locations * this.contract.classCount;
      const expectedBboxLength = level.locations * 4 * (this.contract.regMax + 1);
      if (classScores.length < expectedClassLength) {
        throw new Error(`NanoDet class output ${level.classOutputName} is shorter than its observed contract`);
      }
      if (bboxPredictions.length < expectedBboxLength) {
        throw new Error(`NanoDet bbox output ${level.bboxOutputName} is shorter than its observed contract`);
      }

      const maxScores = new Float32Array(level.locations);
      const classIds = new Int16Array(level.locations);
      const indices = Array.from({ length: level.locations }, (_value, index) => index);
      for (let location = 0; location < level.locations; location += 1) {
        const classOffset = location * this.contract.classCount;
        let bestScore = Number.NEGATIVE_INFINITY;
        let bestClass = -1;
        for (let classId = 0; classId < this.contract.classCount; classId += 1) {
          const score = numericAt(classScores, classOffset + classId);
          if (score > bestScore) {
            bestScore = score;
            bestClass = classId;
          }
        }
        maxScores[location] = bestScore;
        classIds[location] = bestClass;
      }

      if (this.nmsPre > 0 && indices.length > this.nmsPre) {
        indices.sort((a, b) => (maxScores[b] ?? Number.NEGATIVE_INFINITY) - (maxScores[a] ?? Number.NEGATIVE_INFINITY));
        indices.length = this.nmsPre;
      }

      const featureWidth = Math.round(this.contract.inputWidth / level.stride);
      for (const location of indices) {
        const confidence = maxScores[location] ?? Number.NaN;
        const classId = classIds[location] ?? -1;
        if (!Number.isFinite(confidence) || confidence < this.scoreThreshold || classId < 0) continue;

        const row = Math.floor(location / featureWidth);
        const column = location % featureWidth;
        const centerX = (column * level.stride) + (0.5 * (level.stride - 1));
        const centerY = (row * level.stride) + (0.5 * (level.stride - 1));
        const bboxOffset = location * 4 * NANODET_REG_BINS;
        const left = stableExpectedBin(bboxPredictions, bboxOffset) * level.stride;
        const top = stableExpectedBin(bboxPredictions, bboxOffset + NANODET_REG_BINS) * level.stride;
        const right = stableExpectedBin(bboxPredictions, bboxOffset + (2 * NANODET_REG_BINS)) * level.stride;
        const bottom = stableExpectedBin(bboxPredictions, bboxOffset + (3 * NANODET_REG_BINS)) * level.stride;
        if (![left, top, right, bottom].every(Number.isFinite)) continue;

        decoded.push({
          classId,
          confidence,
          x1: clamp(centerX - left, 0, this.contract.inputWidth),
          y1: clamp(centerY - top, 0, this.contract.inputHeight),
          x2: clamp(centerX + right, 0, this.contract.inputWidth),
          y2: clamp(centerY + bottom, 0, this.contract.inputHeight),
        });
      }
    }

    const kept = nmsClassAgnostic(decoded, this.iouThreshold);
    const detections: RawDetection[] = [];
    for (const candidate of kept) {
      const className = this.classMap[candidate.classId];
      if (!className) continue;
      const bbox = modelBoxToSource(candidate, context.transform);
      if (!(bbox.width > 0) || !(bbox.height > 0)) continue;
      detections.push({
        classId: candidate.classId,
        className,
        confidence: candidate.confidence,
        bbox,
      });
    }
    return detections;
  }
}
