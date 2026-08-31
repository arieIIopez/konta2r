import { describe, expect, it } from 'vitest';
import type { AnnotatedBenchmarkSequence } from '../../src/detection/benchmarkDataset';
import { runExternalCandidateBenchmarkSession } from '../../src/detection/externalBenchmarkSession';
import { OPENCV_SSD_MOBILENET_V2_COCO_2026JUL } from '../../src/detection/modelCandidates';
import { assessCandidateProbeCompatibility } from '../../src/detection/onnx/candidateProbeCompatibility';
import type { VerifiedOnnxArtifact } from '../../src/detection/onnx/modelArtifact';
import type { OnnxModelProbeResult } from '../../src/detection/onnx/modelProbe';
import {
  buildOnnxCandidateProbeDiagnosticRecord,
  type OnnxCandidateProbeDiagnosticRecord,
} from '../../src/detection/onnx/probeDiagnostic';
import { buildOnnxProbeRecord } from '../../src/detection/onnx/probeRecord';
import type {
  OnnxExecutionProvider,
  OnnxModelSource,
  OnnxSessionFactory,
  OnnxSessionLike,
  OnnxValueMap,
} from '../../src/detection/onnx/runtime';
import type { BenchmarkFrameProvider } from '../../src/detection/streamingBenchmark';

function probe(): OnnxModelProbeResult {
  return {
    runtime: { runtime: 'onnxruntime-web', runtimeVersion: '1.29.0', backend: 'wasm', executionProviders: ['wasm'] },
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

function diagnostic(): OnnxCandidateProbeDiagnosticRecord {
  const candidate = OPENCV_SSD_MOBILENET_V2_COCO_2026JUL;
  const observed = probe();
  return buildOnnxCandidateProbeDiagnosticRecord(
    buildOnnxProbeRecord(candidate, { sha256: candidate.artifact.sha256, sizeBytes: 4 }, observed, new Date('2026-08-31T04:30:00.000Z')),
    assessCandidateProbeCompatibility(candidate, observed),
  );
}

function artifact(): VerifiedOnnxArtifact {
  return { bytes: new Uint8Array([1, 2, 3, 4]), sha256: OPENCV_SSD_MOBILENET_V2_COCO_2026JUL.artifact.sha256, sizeBytes: 4 };
}

class SweepSession implements OnnxSessionLike {
  runCount = 0;
  releaseCount = 0;
  private tensor(data: Float32Array) { return { data, dispose: () => undefined }; }
  async run(_feeds: OnnxValueMap): Promise<OnnxValueMap> {
    this.runCount += 1;
    return {
      'detection_boxes:0': this.tensor(new Float32Array([0.1, 0.1, 0.5, 0.4, 0.1, 0.7, 0.5, 0.9])),
      'detection_scores:0': this.tensor(new Float32Array([0.9, 0.2])),
      'detection_classes:0': this.tensor(new Float32Array([1, 1])),
      'num_detections:0': this.tensor(new Float32Array([2])),
    };
  }
  release(): void { this.releaseCount += 1; }
}

class SweepFactory implements OnnxSessionFactory {
  createCount = 0;
  readonly session = new SweepSession();
  async create(_source: OnnxModelSource, _providers: readonly OnnxExecutionProvider[]): Promise<OnnxSessionLike> {
    this.createCount += 1;
    return this.session;
  }
}

const sequence: AnnotatedBenchmarkSequence = {
  schemaVersion: '1', datasetId: 'confidence-corpus', sequenceId: 'seq-1',
  source: { annotationSha256: 'a'.repeat(64), mediaSha256: 'b'.repeat(64) },
  frames: [{
    frameId: 'f1', timestampMs: 1000, mediaTimeMs: 500, width: 1000, height: 500,
    objects: [{ annotationId: 'person-1', className: 'person', bbox: { x: 100, y: 50, width: 300, height: 200 } }],
  }],
};

const provider: BenchmarkFrameProvider = {
  async materialize() { return { source: {} as CanvasImageSource, actualMediaTimeMs: 500 }; },
};

describe('external benchmark confidence analysis', () => {
  it('produces primary metrics and a confidence sweep from one inference pass', async () => {
    const factory = new SweepFactory();
    const result = await runExternalCandidateBenchmarkSession(
      OPENCV_SSD_MOBILENET_V2_COCO_2026JUL, artifact(), diagnostic(), sequence, provider,
      {
        runId: 'confidence-session', device: { label: 'test-phone' },
        detector: {
          minConfidence: 0.05, capabilities: { webgpu: false }, sessionFactory: factory,
          ssdRgbResize: () => new Uint8Array(300 * 300 * 3),
        },
        benchmark: {
          iouThreshold: 0.5,
          confidence: { operatingConfidenceThreshold: 0.5, sweepThresholds: [0.1, 0.5, 0.95] },
        },
        validity: { profile: 'development' },
      },
    );

    expect(factory.createCount).toBe(1);
    expect(factory.session.runCount).toBe(1);
    expect(factory.session.releaseCount).toBe(1);
    expect(result.report.benchmark.classMetrics[0]).toMatchObject({
      className: 'person', truePositive: 1, falsePositive: 0, falseNegative: 0, f1: 1,
    });
    expect(result.report.confidence?.operatingConfidenceThreshold).toBe(0.5);
    expect(result.report.confidence?.sweep.points[0]?.classMetrics[0]).toMatchObject({
      truePositive: 1, falsePositive: 1, falseNegative: 0, precision: 0.5, recall: 1,
    });
    expect(result.report.confidence?.sweep.bestObservedMacroF1).toEqual({ threshold: 0.5, macroF1: 1 });
    expect(result.validity.status).toBe('valid');
  });

  it('rejects a sweep below the adapter retention floor before creating an ONNX session', async () => {
    const factory = new SweepFactory();
    await expect(runExternalCandidateBenchmarkSession(
      OPENCV_SSD_MOBILENET_V2_COCO_2026JUL, artifact(), diagnostic(), sequence, provider,
      {
        runId: 'invalid-floor', device: { label: 'test-phone' },
        detector: {
          minConfidence: 0.5, capabilities: { webgpu: false }, sessionFactory: factory,
          ssdRgbResize: () => new Uint8Array(300 * 300 * 3),
        },
        benchmark: { confidence: { operatingConfidenceThreshold: 0.5, sweepThresholds: [0.1, 0.5] } },
        validity: { profile: 'development' },
      },
    )).rejects.toThrow('filtered detections cannot be recovered');
    expect(factory.createCount).toBe(0);
  });
});
