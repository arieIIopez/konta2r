import { describe, expect, it } from 'vitest';
import type { DetectorInput } from '../../../src/detection/types';
import type { OnnxModelProbeResult } from '../../../src/detection/onnx/modelProbe';
import {
  NanoDetPlusCodec,
  assessNanoDetPlusProbeCompatibility,
  calculateNanoDetLetterboxTransform,
} from '../../../src/detection/onnx/nanodetPlus';

function compatibleProbe(): OnnxModelProbeResult {
  return {
    runtime: {
      runtime: 'onnxruntime-web',
      runtimeVersion: '1.29.0',
      backend: 'wasm',
      executionProviders: ['wasm'],
    },
    webgpuAttempted: false,
    inputs: [{ name: 'input.1', kind: 'tensor', type: 'float32', shape: [1, 3, 416, 416] }],
    outputs: [
      { name: '792', kind: 'tensor', type: 'float32', shape: [1, 2704, 80] },
      { name: '814', kind: 'tensor', type: 'float32', shape: [1, 676, 80] },
      { name: '836', kind: 'tensor', type: 'float32', shape: [1, 169, 80] },
      { name: '795', kind: 'tensor', type: 'float32', shape: [1, 2704, 32] },
      { name: '817', kind: 'tensor', type: 'float32', shape: [1, 676, 32] },
      { name: '839', kind: 'tensor', type: 'float32', shape: [1, 169, 32] },
    ],
  };
}

function detectorInput(): DetectorInput {
  return {
    source: {} as CanvasImageSource,
    sourceWidth: 1_000,
    sourceHeight: 500,
    timestampMs: 12_345,
  };
}

function tensorData(data: Float32Array): { data: Float32Array } {
  return { data };
}

function emptyOutputs(): Record<string, { data: Float32Array }> {
  return {
    '792': tensorData(new Float32Array(2704 * 80)),
    '814': tensorData(new Float32Array(676 * 80)),
    '836': tensorData(new Float32Array(169 * 80)),
    '795': tensorData(new Float32Array(2704 * 32)),
    '817': tensorData(new Float32Array(676 * 32)),
    '839': tensorData(new Float32Array(169 * 32)),
  };
}

function setDistributionPeak(
  values: Float32Array,
  location: number,
  side: number,
  bin: number,
): void {
  const base = (location * 32) + (side * 8);
  for (let index = 0; index < 8; index += 1) values[base + index] = -20;
  values[base + bin] = 20;
}

describe('NanoDet Plus codec', () => {
  it('derives the exact 2022 checkpoint contract from shapes rather than opaque output order', () => {
    const assessment = assessNanoDetPlusProbeCompatibility(compatibleProbe());
    expect(assessment.compatible).toBe(true);
    expect(assessment.errors).toEqual([]);
    expect(assessment.contract?.inputName).toBe('input.1');
    expect(assessment.contract?.levels).toEqual([
      { stride: 8, locations: 2704, classOutputName: '792', bboxOutputName: '795' },
      { stride: 16, locations: 676, classOutputName: '814', bboxOutputName: '817' },
      { stride: 32, locations: 169, classOutputName: '836', bboxOutputName: '839' },
    ]);
  });

  it('rejects a hypothetical fourth stride-64 pair because it is not part of the observed artifact contract', () => {
    const probe = compatibleProbe();
    probe.outputs.push(
      { name: 'extra-class', kind: 'tensor', type: 'float32', shape: [1, 36, 80] },
      { name: 'extra-box', kind: 'tensor', type: 'float32', shape: [1, 36, 32] },
    );
    const assessment = assessNanoDetPlusProbeCompatibility(probe);
    expect(assessment.compatible).toBe(false);
    expect(assessment.errors).toContain('output_count_expected_6:8');
  });

  it('matches the integer letterbox geometry used by the original OpenCV Zoo demo', () => {
    expect(calculateNanoDetLetterboxTransform(1_000, 500)).toMatchObject({
      resizedWidth: 416,
      resizedHeight: 208,
      left: 0,
      top: 104,
    });
    expect(calculateNanoDetLetterboxTransform(500, 1_000)).toMatchObject({
      resizedWidth: 208,
      resizedHeight: 416,
      left: 104,
      top: 0,
    });
  });

  it('normalizes RGB into float32 NCHW with the documented NanoDet mean and standard deviation', async () => {
    const rgb = new Uint8Array(416 * 416 * 3);
    rgb[0] = 103;
    rgb[1] = 116;
    rgb[2] = 124;
    const transform = calculateNanoDetLetterboxTransform(1_000, 500);
    const codec = NanoDetPlusCodec.fromProbe(compatibleProbe(), {
      letterboxRgb: () => ({ rgb, transform }),
    });

    const prepared = await codec.prepare(detectorInput());
    const feed = prepared.feeds['input.1'] as {
      type?: string;
      dims?: readonly number[];
      data?: Float32Array;
    };
    const plane = 416 * 416;
    expect(feed.type).toBe('float32');
    expect(feed.dims).toEqual([1, 3, 416, 416]);
    expect(feed.data?.[0]).toBeCloseTo((103 - 103.53) / 57.375, 6);
    expect(feed.data?.[plane]).toBeCloseTo((116 - 116.28) / 57.12, 6);
    expect(feed.data?.[2 * plane]).toBeCloseTo((124 - 123.675) / 58.395, 6);
    expect(prepared.context.transform).toEqual(transform);
    await prepared.dispose?.();
  });

  it('decodes GFL distance distributions, maps COCO classes, and removes letterbox padding', () => {
    const outputs = emptyOutputs();
    const location = (6 * 13) + 6;
    outputs['836'].data[(location * 80) + 1] = 0.9;
    for (let side = 0; side < 4; side += 1) {
      setDistributionPeak(outputs['839'].data, location, side, 1);
    }

    const transform = calculateNanoDetLetterboxTransform(1_000, 500);
    const codec = NanoDetPlusCodec.fromProbe(compatibleProbe(), {
      scoreThreshold: 0.5,
      letterboxRgb: () => ({ rgb: new Uint8Array(416 * 416 * 3), transform }),
    });
    const detections = codec.decode(outputs, { transform });

    expect(detections).toHaveLength(1);
    expect(detections[0]).toMatchObject({
      classId: 1,
      className: 'bicycle',
      confidence: expect.closeTo(0.9, 5),
    });
    expect(detections[0]?.bbox.x).toBeCloseTo(421.875, 2);
    expect(detections[0]?.bbox.y).toBeCloseTo(171.875, 2);
    expect(detections[0]?.bbox.width).toBeCloseTo(153.846, 2);
    expect(detections[0]?.bbox.height).toBeCloseTo(153.846, 2);
  });

  it('fails closed when an observed head is shorter than its declared tensor shape', () => {
    const outputs = emptyOutputs();
    outputs['839'] = tensorData(new Float32Array(10));
    const transform = calculateNanoDetLetterboxTransform(640, 640);
    const codec = NanoDetPlusCodec.fromProbe(compatibleProbe(), {
      letterboxRgb: () => ({ rgb: new Uint8Array(416 * 416 * 3), transform }),
    });
    expect(() => codec.decode(outputs, { transform })).toThrow('shorter than its observed contract');
  });
});
