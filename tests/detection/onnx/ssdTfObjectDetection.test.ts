import { describe, expect, it } from 'vitest';
import type { DetectorInput } from '../../../src/detection/types';
import type { OnnxModelProbeResult } from '../../../src/detection/onnx/modelProbe';
import {
  DOCUMENTED_SSD_MOBILENET_V2_COCO_2018_CONTRACT,
  SsdTfObjectDetectionCodec,
  assessSsdTfProbeCompatibility,
} from '../../../src/detection/onnx/ssdTfObjectDetection';

function compatibleProbe(): OnnxModelProbeResult {
  return {
    runtime: {
      runtime: 'onnxruntime-web',
      runtimeVersion: '1.29.0',
      backend: 'wasm',
      executionProviders: ['wasm'],
    },
    webgpuAttempted: false,
    inputs: [
      {
        name: 'image_tensor:0',
        kind: 'tensor',
        type: 'uint8',
        shape: [1, 300, 300, 3],
      },
    ],
    outputs: [
      {
        name: 'detection_boxes:0',
        kind: 'tensor',
        type: 'float32',
        shape: [1, 100, 4],
      },
      {
        name: 'detection_scores:0',
        kind: 'tensor',
        type: 'float32',
        shape: [1, 100],
      },
      {
        name: 'detection_classes:0',
        kind: 'tensor',
        type: 'float32',
        shape: [1, 100],
      },
      {
        name: 'num_detections:0',
        kind: 'tensor',
        type: 'float32',
        shape: [1],
      },
    ],
  };
}

function detectorInput(): DetectorInput {
  return {
    source: {} as CanvasImageSource,
    sourceWidth: 1_000,
    sourceHeight: 500,
    timestampMs: 1_234,
  };
}

function tensorData(data: Float32Array): { data: Float32Array } {
  return { data };
}

describe('SSD TensorFlow Object Detection codec', () => {
  it('accepts a fully observed probe matching the documented contract', () => {
    const assessment = assessSsdTfProbeCompatibility(compatibleProbe());
    expect(assessment.compatible).toBe(true);
    expect(assessment.errors).toEqual([]);
  });

  it('rejects names-only probe metadata rather than trusting documented tensor names', () => {
    const probe = compatibleProbe();
    probe.inputs = [{ name: 'image_tensor:0', kind: 'unknown' }];
    probe.outputs = DOCUMENTED_SSD_MOBILENET_V2_COCO_2018_CONTRACT.outputNames
      ? Object.values(DOCUMENTED_SSD_MOBILENET_V2_COCO_2018_CONTRACT.outputNames)
        .map((name) => ({ name, kind: 'unknown' as const }))
      : [];

    const assessment = assessSsdTfProbeCompatibility(probe);
    expect(assessment.compatible).toBe(false);
    expect(assessment.errors).toContain('input_not_tensor:image_tensor:0');
    expect(assessment.errors.some((error) => error.startsWith('input_type_expected_uint8'))).toBe(true);
    expect(assessment.errors.some((error) => error.startsWith('input_shape_mismatch'))).toBe(true);
  });

  it('rejects incompatible input dtype or dimensions before codec construction', () => {
    const probe = compatibleProbe();
    probe.inputs = [{
      name: 'image_tensor:0',
      kind: 'tensor',
      type: 'float32',
      shape: [1, 320, 320, 3],
    }];

    expect(() => SsdTfObjectDetectionCodec.fromProbe(probe, {
      resizeRgb: () => new Uint8Array(300 * 300 * 3),
    })).toThrow('SSD TensorFlow ONNX contract mismatch');
  });

  it('prepares the documented uint8 NHWC tensor and preserves source geometry context', async () => {
    const codec = SsdTfObjectDetectionCodec.fromProbe(compatibleProbe(), {
      resizeRgb: (_source, width, height) => {
        expect(width).toBe(300);
        expect(height).toBe(300);
        return new Uint8Array(width * height * 3).fill(7);
      },
    });

    const prepared = await codec.prepare(detectorInput());
    const feed = prepared.feeds['image_tensor:0'] as {
      type?: string;
      dims?: readonly number[];
      data?: Uint8Array;
    };

    expect(feed.type).toBe('uint8');
    expect(feed.dims).toEqual([1, 300, 300, 3]);
    expect(feed.data?.length).toBe(270_000);
    expect(prepared.context).toEqual({ sourceWidth: 1_000, sourceHeight: 500 });
    await prepared.dispose?.();
  });

  it('rejects a preprocessor that returns the wrong RGB byte count', async () => {
    const codec = SsdTfObjectDetectionCodec.fromProbe(compatibleProbe(), {
      resizeRgb: () => new Uint8Array(10),
    });

    await expect(codec.prepare(detectorInput())).rejects.toThrow('expected 270000');
  });

  it('decodes normalized yxyx boxes, clips frame edges, and keeps mobility COCO classes only', () => {
    const codec = SsdTfObjectDetectionCodec.fromProbe(compatibleProbe(), {
      resizeRgb: () => new Uint8Array(300 * 300 * 3),
    });

    const detections = codec.decode({
      'detection_boxes:0': tensorData(new Float32Array([
        0.1, 0.2, 0.5, 0.6,
        -0.1, 0.7, 1.2, 1.1,
        0.0, 0.0, 0.3, 0.3,
      ])),
      'detection_scores:0': tensorData(new Float32Array([0.9, 0.8, 0.7])),
      'detection_classes:0': tensorData(new Float32Array([1, 2, 5])),
      'num_detections:0': tensorData(new Float32Array([3])),
    }, { sourceWidth: 1_000, sourceHeight: 500 });

    expect(detections).toHaveLength(2);
    expect(detections[0]).toMatchObject({
      classId: 1,
      className: 'person',
      confidence: expect.closeTo(0.9, 5),
    });
    expect(detections[0]?.bbox.x).toBeCloseTo(200, 4);
    expect(detections[0]?.bbox.y).toBeCloseTo(50, 4);
    expect(detections[0]?.bbox.width).toBeCloseTo(400, 4);
    expect(detections[0]?.bbox.height).toBeCloseTo(200, 4);

    expect(detections[1]).toMatchObject({
      classId: 2,
      className: 'bicycle',
      confidence: expect.closeTo(0.8, 5),
    });
    expect(detections[1]?.bbox).toMatchObject({ x: expect.closeTo(700, 4), y: 0 });
    expect(detections[1]?.bbox.width).toBeCloseTo(300, 4);
    expect(detections[1]?.bbox.height).toBeCloseTo(500, 4);
  });

  it('never reads beyond the shortest available SSD output vector', () => {
    const codec = SsdTfObjectDetectionCodec.fromProbe(compatibleProbe(), {
      resizeRgb: () => new Uint8Array(300 * 300 * 3),
    });

    const detections = codec.decode({
      'detection_boxes:0': tensorData(new Float32Array([
        0.0, 0.0, 0.2, 0.2,
        0.2, 0.2, 0.4, 0.4,
      ])),
      'detection_scores:0': tensorData(new Float32Array([0.9])),
      'detection_classes:0': tensorData(new Float32Array([3, 6])),
      'num_detections:0': tensorData(new Float32Array([99])),
    }, { sourceWidth: 640, sourceHeight: 360 });

    expect(detections).toHaveLength(1);
    expect(detections[0]?.className).toBe('car');
  });
});
