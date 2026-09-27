import { describe, expect, it } from 'vitest';
import { OnnxDetectorAdapter } from '../../../src/detection/onnx/adapter';
import { SsdTfObjectDetectionCodec } from '../../../src/detection/onnx/ssdTfObjectDetection';
import type { OnnxModelProbeResult } from '../../../src/detection/onnx/modelProbe';
import type {
  OnnxExecutionProvider,
  OnnxModelSource,
  OnnxSessionFactory,
  OnnxSessionLike,
  OnnxValueMap,
} from '../../../src/detection/onnx/runtime';

function compatibleProbe(): OnnxModelProbeResult {
  return {
    runtime: {
      runtime: 'onnxruntime-web',
      runtimeVersion: '1.29.0',
      backend: 'wasm',
      executionProviders: ['wasm'],
    },
    webgpuAttempted: false,
    inputs: [{ name: 'image_tensor:0', kind: 'tensor', type: 'uint8', shape: [1, 300, 300, 3] }],
    outputs: [
      { name: 'detection_boxes:0', kind: 'tensor', type: 'float32', shape: [1, 100, 4] },
      { name: 'detection_scores:0', kind: 'tensor', type: 'float32', shape: [1, 100] },
      { name: 'detection_classes:0', kind: 'tensor', type: 'float32', shape: [1, 100] },
      { name: 'num_detections:0', kind: 'tensor', type: 'float32', shape: [1] },
    ],
  };
}

class SsdFakeSession implements OnnxSessionLike {
  outputDisposeCount = 0;
  releaseCount = 0;

  private output(data: Float32Array): { data: Float32Array; dispose: () => void } {
    return {
      data,
      dispose: () => { this.outputDisposeCount += 1; },
    };
  }

  async run(_feeds: OnnxValueMap): Promise<OnnxValueMap> {
    return {
      'detection_boxes:0': this.output(new Float32Array([
        0.1, 0.1, 0.6, 0.4,
        0.2, 0.5, 0.5, 0.9,
      ])),
      'detection_scores:0': this.output(new Float32Array([0.92, 0.70])),
      'detection_classes:0': this.output(new Float32Array([1, 3])),
      'num_detections:0': this.output(new Float32Array([2])),
    };
  }

  release(): void {
    this.releaseCount += 1;
  }
}

class SsdFakeFactory implements OnnxSessionFactory {
  readonly session = new SsdFakeSession();

  async create(
    _source: OnnxModelSource,
    _executionProviders: readonly OnnxExecutionProvider[],
  ): Promise<OnnxSessionLike> {
    return this.session;
  }
}

const experimentalModel = {
  adapterId: 'ssd-tf-object-detection',
  modelId: 'ssd-mobilenet-v2-coco-test',
  modelVersion: 'test',
  modelSha256: 'a'.repeat(64),
  codeLicense: 'Apache-2.0',
  weightsLicense: 'unverified',
  weightsRedistributionVerified: false,
  inputWidth: 300,
  inputHeight: 300,
  classNames: ['person', 'bicycle', 'car', 'motorcycle', 'bus', 'truck', 'cat', 'dog', 'skateboard'],
  registeredAtIso: '2026-08-31T00:00:00.000Z',
};

describe('SSD TensorFlow codec + generic ONNX adapter', () => {
  it('decodes SSD outputs, applies adapter confidence filtering, and releases runtime outputs', async () => {
    const factory = new SsdFakeFactory();
    const codec = SsdTfObjectDetectionCodec.fromProbe(compatibleProbe(), {
      resizeRgb: () => new Uint8Array(300 * 300 * 3),
    });
    const adapter = new OnnxDetectorAdapter({
      model: experimentalModel,
      modelSource: new Uint8Array([1, 2, 3]),
      codec,
      capabilities: { webgpu: false },
      sessionFactory: factory,
      minConfidence: 0.85,
    });

    await adapter.initialize();
    const output = await adapter.detect({
      source: {} as CanvasImageSource,
      sourceWidth: 1_000,
      sourceHeight: 500,
      timestampMs: 5_000,
    });

    expect(output.telemetry.detectionCountBeforeFiltering).toBe(2);
    expect(output.telemetry.detectionCount).toBe(1);
    expect(output.detections).toHaveLength(1);
    expect(output.detections[0]?.className).toBe('person');
    expect(output.detections[0]?.bbox.x).toBeCloseTo(100, 4);
    expect(output.detections[0]?.bbox.y).toBeCloseTo(50, 4);
    expect(output.detections[0]?.bbox.width).toBeCloseTo(300, 4);
    expect(output.detections[0]?.bbox.height).toBeCloseTo(250, 4);
    expect(factory.session.outputDisposeCount).toBe(4);

    await adapter.dispose();
    expect(factory.session.releaseCount).toBe(1);
  });
});
