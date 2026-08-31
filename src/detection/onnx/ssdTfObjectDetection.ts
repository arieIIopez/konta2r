import * as ort from 'onnxruntime-web/webgpu';
import type { RawDetection } from '../../core/types';
import type { DetectorInput } from '../types';
import type { OnnxDetectorCodec, OnnxPreparedInput } from './codec';
import type { OnnxModelProbeResult } from './modelProbe';
import type { OnnxValueMap, OnnxValueMetadata } from './runtime';

export interface SsdTfObjectDetectionContract {
  inputName: string;
  inputWidth: number;
  inputHeight: number;
  inputLayout: 'NHWC';
  outputNames: {
    boxes: string;
    scores: string;
    classes: string;
    numDetections: string;
  };
}

/**
 * Documented contract for TensorFlow Object Detection API SSD MobileNet V2
 * conversions that preserve the frozen-graph public tensor names.
 *
 * This constant is evidence from source documentation, not a statement that an
 * arbitrary SSD ONNX artifact has been probed successfully.
 */
export const DOCUMENTED_SSD_MOBILENET_V2_COCO_2018_CONTRACT: SsdTfObjectDetectionContract = {
  inputName: 'image_tensor:0',
  inputWidth: 300,
  inputHeight: 300,
  inputLayout: 'NHWC',
  outputNames: {
    boxes: 'detection_boxes:0',
    scores: 'detection_scores:0',
    classes: 'detection_classes:0',
    numDetections: 'num_detections:0',
  },
};

export const SSD_TF_MOBILITY_COCO_CLASS_MAP: Readonly<Record<number, string>> = {
  1: 'person',
  2: 'bicycle',
  3: 'car',
  4: 'motorcycle',
  6: 'bus',
  8: 'truck',
  17: 'cat',
  18: 'dog',
  41: 'skateboard',
};

export interface SsdTfProbeAssessment {
  compatible: boolean;
  errors: string[];
  warnings: string[];
}

function metadataByName(
  values: readonly OnnxValueMetadata[],
  name: string,
): OnnxValueMetadata | undefined {
  return values.find((value) => value.name === name);
}

function exactNumericShape(
  shape: readonly (string | number)[] | undefined,
  expected: readonly number[],
): boolean {
  return shape !== undefined
    && shape.length === expected.length
    && shape.every((value, index) => typeof value === 'number' && value === expected[index]);
}

function tensorType(value: OnnxValueMetadata | undefined): string | undefined {
  return value?.type?.trim().toLowerCase();
}

function isNumericTensorType(value: string | undefined): boolean {
  return value === undefined || [
    'float32', 'float64', 'int8', 'uint8', 'int16', 'uint16',
    'int32', 'uint32', 'int64', 'uint64',
  ].includes(value);
}

/**
 * Requires observed runtime metadata before a documented SSD contract may be
 * treated as compatible. Names-only probes are intentionally insufficient.
 */
export function assessSsdTfProbeCompatibility(
  probe: OnnxModelProbeResult,
  contract: SsdTfObjectDetectionContract = DOCUMENTED_SSD_MOBILENET_V2_COCO_2018_CONTRACT,
): SsdTfProbeAssessment {
  const errors: string[] = [];
  const warnings: string[] = [];
  const input = metadataByName(probe.inputs, contract.inputName);

  if (!input) {
    errors.push(`missing_input:${contract.inputName}`);
  } else {
    if (input.kind !== 'tensor') errors.push(`input_not_tensor:${contract.inputName}`);
    const type = tensorType(input);
    if (type !== 'uint8') errors.push(`input_type_expected_uint8:${type ?? 'unknown'}`);
    if (!exactNumericShape(input.shape, [1, contract.inputHeight, contract.inputWidth, 3])) {
      errors.push(`input_shape_mismatch:${input.shape?.join('x') ?? 'unknown'}`);
    }
  }

  const outputEntries = Object.entries(contract.outputNames) as Array<
    [keyof SsdTfObjectDetectionContract['outputNames'], string]
  >;
  for (const [role, name] of outputEntries) {
    const metadata = metadataByName(probe.outputs, name);
    if (!metadata) {
      errors.push(`missing_output_${role}:${name}`);
      continue;
    }
    if (metadata.kind !== 'tensor') errors.push(`output_not_tensor_${role}:${name}`);
    const type = tensorType(metadata);
    if (!isNumericTensorType(type)) errors.push(`output_not_numeric_${role}:${type ?? 'unknown'}`);
  }

  const boxes = metadataByName(probe.outputs, contract.outputNames.boxes);
  if (boxes?.shape && boxes.shape.length >= 1) {
    const finalDimension = boxes.shape.at(-1);
    if (typeof finalDimension === 'number' && finalDimension !== 4) {
      errors.push(`boxes_last_dimension_expected_4:${finalDimension}`);
    }
  } else if (boxes) {
    warnings.push('boxes_shape_not_reported');
  }

  const scores = metadataByName(probe.outputs, contract.outputNames.scores);
  const classes = metadataByName(probe.outputs, contract.outputNames.classes);
  if (scores?.shape && classes?.shape && JSON.stringify(scores.shape) !== JSON.stringify(classes.shape)) {
    warnings.push('scores_classes_shapes_differ');
  }

  return { compatible: errors.length === 0, errors, warnings };
}

export function assertSsdTfProbeCompatible(
  probe: OnnxModelProbeResult,
  contract: SsdTfObjectDetectionContract = DOCUMENTED_SSD_MOBILENET_V2_COCO_2018_CONTRACT,
): void {
  const assessment = assessSsdTfProbeCompatibility(probe, contract);
  if (!assessment.compatible) {
    throw new Error(`SSD TensorFlow ONNX contract mismatch: ${assessment.errors.join(', ')}`);
  }
}

export type SsdTfRgbResize = (
  source: CanvasImageSource,
  width: number,
  height: number,
) => Promise<Uint8Array> | Uint8Array;

interface ScratchCanvas {
  width: number;
  height: number;
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
}

function createScratchCanvas(width: number, height: number): ScratchCanvas {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Unable to create OffscreenCanvas 2D context for SSD preprocessing');
    return { width, height, context };
  }
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Unable to create canvas 2D context for SSD preprocessing');
    return { width, height, context };
  }
  throw new Error('Canvas 2D API is required for default SSD preprocessing');
}

function createDefaultRgbResizer(): SsdTfRgbResize {
  let scratch: ScratchCanvas | null = null;
  return (source, width, height) => {
    if (!scratch || scratch.width !== width || scratch.height !== height) {
      scratch = createScratchCanvas(width, height);
    }
    scratch.context.clearRect(0, 0, width, height);
    scratch.context.drawImage(source, 0, 0, width, height);
    const rgba = scratch.context.getImageData(0, 0, width, height).data;
    const rgb = new Uint8Array(width * height * 3);
    for (let sourceIndex = 0, targetIndex = 0; sourceIndex < rgba.length; sourceIndex += 4) {
      rgb[targetIndex] = rgba[sourceIndex] ?? 0;
      rgb[targetIndex + 1] = rgba[sourceIndex + 1] ?? 0;
      rgb[targetIndex + 2] = rgba[sourceIndex + 2] ?? 0;
      targetIndex += 3;
    }
    return rgb;
  };
}

interface TensorDataLike {
  readonly length: number;
  readonly [index: number]: number | bigint;
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
  const length = (data as { length?: unknown }).length;
  if (typeof length !== 'number' || !Number.isInteger(length) || length < 0) {
    throw new Error(`ONNX output ${name} has invalid data length`);
  }
  return data as TensorDataLike;
}

function numericAt(data: TensorDataLike, index: number): number {
  if (index < 0 || index >= data.length) return Number.NaN;
  return Number(data[index]);
}

function finiteBoxCoordinates(values: readonly number[]): boolean {
  return values.every(Number.isFinite);
}

export interface SsdTfObjectDetectionCodecOptions {
  contract?: SsdTfObjectDetectionContract;
  classMap?: Readonly<Record<number, string>>;
  resizeRgb?: SsdTfRgbResize;
}

export interface SsdTfFrameContext {
  sourceWidth: number;
  sourceHeight: number;
}

/**
 * Codec for TensorFlow Object Detection API SSD exports whose ONNX graph emits
 * normalized [ymin,xmin,ymax,xmax] boxes, scores, 1-based class ids and a
 * num_detections scalar. Use assertSsdTfProbeCompatible() before activating a
 * concrete external checkpoint.
 */
export class SsdTfObjectDetectionCodec implements OnnxDetectorCodec<SsdTfFrameContext> {
  private readonly contract: SsdTfObjectDetectionContract;
  private readonly classMap: Readonly<Record<number, string>>;
  private readonly resizeRgb: SsdTfRgbResize;

  constructor(options: SsdTfObjectDetectionCodecOptions = {}) {
    this.contract = options.contract ?? DOCUMENTED_SSD_MOBILENET_V2_COCO_2018_CONTRACT;
    this.classMap = options.classMap ?? SSD_TF_MOBILITY_COCO_CLASS_MAP;
    this.resizeRgb = options.resizeRgb ?? createDefaultRgbResizer();
  }

  async prepare(input: DetectorInput): Promise<OnnxPreparedInput<SsdTfFrameContext>> {
    const rgb = await this.resizeRgb(input.source, this.contract.inputWidth, this.contract.inputHeight);
    const expectedLength = this.contract.inputWidth * this.contract.inputHeight * 3;
    if (rgb.length !== expectedLength) {
      throw new Error(`SSD RGB preprocessor returned ${rgb.length} bytes; expected ${expectedLength}`);
    }
    const tensor = new ort.Tensor('uint8', rgb, [
      1,
      this.contract.inputHeight,
      this.contract.inputWidth,
      3,
    ]);
    return {
      feeds: { [this.contract.inputName]: tensor },
      context: {
        sourceWidth: input.sourceWidth,
        sourceHeight: input.sourceHeight,
      },
      dispose: () => tensor.dispose(),
    };
  }

  decode(
    outputs: OnnxValueMap,
    context: SsdTfFrameContext,
  ): RawDetection[] {
    const boxes = tensorData(outputs, this.contract.outputNames.boxes);
    const scores = tensorData(outputs, this.contract.outputNames.scores);
    const classes = tensorData(outputs, this.contract.outputNames.classes);
    const numDetections = tensorData(outputs, this.contract.outputNames.numDetections);

    const declaredCount = Math.max(0, Math.floor(numericAt(numDetections, 0)));
    const availableCount = Math.min(
      Math.floor(boxes.length / 4),
      scores.length,
      classes.length,
    );
    const count = Math.min(declaredCount, availableCount);
    const detections: RawDetection[] = [];

    for (let index = 0; index < count; index += 1) {
      const score = numericAt(scores, index);
      const classId = Math.round(numericAt(classes, index));
      const className = this.classMap[classId];
      if (!className || !Number.isFinite(score)) continue;

      const offset = index * 4;
      const ymin = numericAt(boxes, offset);
      const xmin = numericAt(boxes, offset + 1);
      const ymax = numericAt(boxes, offset + 2);
      const xmax = numericAt(boxes, offset + 3);
      if (!finiteBoxCoordinates([ymin, xmin, ymax, xmax])) continue;

      const x = xmin * context.sourceWidth;
      const y = ymin * context.sourceHeight;
      const width = (xmax - xmin) * context.sourceWidth;
      const height = (ymax - ymin) * context.sourceHeight;
      if (!(width > 0) || !(height > 0)) continue;

      detections.push({
        classId,
        className,
        confidence: score,
        bbox: { x, y, width, height },
      });
    }

    return detections;
  }
}
