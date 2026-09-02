import { describe, expect, it } from 'vitest';
import { OPENCV_SSD_MOBILENET_V2_COCO_2026JUL } from '../../src/detection/modelCandidates';
import type { AnnotatedBenchmarkSequence } from '../../src/detection/benchmarkDataset';
import { runExternalCandidateBenchmarkSession } from '../../src/detection/externalBenchmarkSession';
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
    buildOnnxProbeRecord(candidate, { sha256: candidate.artifact.sha256, sizeBytes: 4 }, observed, new Date('2026-08-31T03:30:00.000Z')),
    assessCandidateProbeCompatibility(candidate, observed),
  );
}

function artifact(): VerifiedOnnxArtifact {
  return { bytes: new Uint8Array([1, 2, 3, 4]), sha256: OPENCV_SSD_MOBILENET_V2_COCO_2026JUL.artifact.sha256, sizeBytes: 4 };
}

class DetectionSession implements OnnxSessionLike {
  releaseCount = 0;
  private output(data: Float32Array): { data: Float32Array; dispose: () => void } {
    return { data, dispose: () => undefined };
  }
  async run(_feeds: OnnxValueMap): Promise<OnnxValueMap> {
    return {
      'detection_boxes:0': this.output(new Float32Array([0.1, 0.2, 0.5, 0.6])),
      'detection_scores:0': this.output(new Float32Array([0.95])),
      'detection_classes:0': this.output(new Float32Array([1])),
      'num_detections:0': this.output(new Float32Array([1])),
    };
  }
  release(): void { this.releaseCount += 1; }
}

class DetectionFactory implements OnnxSessionFactory {
  readonly session = new DetectionSession();
  async create(_source: OnnxModelSource, _providers: readonly OnnxExecutionProvider[]): Promise<OnnxSessionLike> { return this.session; }
}

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const HASH_D = 'd'.repeat(64);
const MANIFEST_SHA = 'e'.repeat(64);

function sequence(includeMediaHash = true): AnnotatedBenchmarkSequence {
  return {
    schemaVersion: '1', datasetId: 'one-frame-mobility', sequenceId: 'seq-001',
    source: { annotationSha256: HASH_A, ...(includeMediaHash ? { mediaSha256: HASH_B } : {}) },
    frames: [{
      frameId: 'f1', timestampMs: 10_000, mediaTimeMs: 1_000, width: 1_000, height: 500,
      objects: [{
        annotationId: 'person-1', className: 'person', bbox: { x: 200, y: 50, width: 400, height: 200 }, occlusion: 'none',
      }],
    }],
  };
}

const provider: BenchmarkFrameProvider = {
  async materialize() { return { source: {} as CanvasImageSource, actualMediaTimeMs: 1_005 }; },
};

function detectorOptions(factory = new DetectionFactory()) {
  return { capabilities: { webgpu: false }, sessionFactory: factory, ssdRgbResize: () => new Uint8Array(300 * 300 * 3) } as const;
}

const validationManifestIdentity = {
  corpusId: 'pilot-manifest', sha256: MANIFEST_SHA, split: 'validation' as const,
};

describe('external candidate benchmark session', () => {
  it('produces a valid selection-profile report only when linked to validation manifest', async () => {
    const factory = new DetectionFactory();
    const progress: string[] = [];
    const result = await runExternalCandidateBenchmarkSession(
      OPENCV_SSD_MOBILENET_V2_COCO_2026JUL, artifact(), diagnostic(), sequence(), provider,
      {
        runId: 'run-valid-001', createdAtIso: '2026-08-31T04:00:00.000Z',
        device: { label: 'synthetic-edge', webgpuAvailable: false },
        manifestIdentity: validationManifestIdentity,
        detector: { ...detectorOptions(factory), minConfidence: 0.5 },
        benchmark: { onProgress: (value) => progress.push(`${value.completedFrames}/${value.totalFrames}:${value.frameId}`) },
        validity: { profile: 'selection' },
      },
    );

    expect(result.candidateId).toBe(OPENCV_SSD_MOBILENET_V2_COCO_2026JUL.id);
    expect(result.redistributionVerified).toBe(false);
    expect(result.report.benchmark.classMetrics[0]).toMatchObject({
      className: 'person', truePositive: 1, falsePositive: 0, falseNegative: 0, precision: 1, recall: 1, f1: 1,
    });
    expect(result.report.benchmark.mediaSeek?.absoluteErrorMaxMs).toBe(5);
    expect(result.report.corpus.manifest).toEqual(validationManifestIdentity);
    expect(result.validity.status).toBe('valid');
    expect(progress).toEqual(['1/1:f1']);
    expect(factory.session.releaseCount).toBe(1);
  });

  it('keeps detector metrics but marks selection evidence invalid when timed medium hash is missing', async () => {
    const result = await runExternalCandidateBenchmarkSession(
      OPENCV_SSD_MOBILENET_V2_COCO_2026JUL, artifact(), diagnostic(), sequence(false), provider,
      {
        runId: 'run-missing-media-hash', device: { label: 'synthetic-edge' },
        manifestIdentity: validationManifestIdentity,
        detector: detectorOptions(), validity: { profile: 'selection' },
      },
    );
    expect(result.report.benchmark.classMetrics[0]?.f1).toBe(1);
    expect(result.validity.status).toBe('invalid');
    expect(result.validity.findings.some((finding) => finding.code === 'media_hash_missing')).toBe(true);
  });

  it('can keep incomplete evidence provisional under development without manifest', async () => {
    const result = await runExternalCandidateBenchmarkSession(
      OPENCV_SSD_MOBILENET_V2_COCO_2026JUL, artifact(), diagnostic(), sequence(false), provider,
      {
        runId: 'run-development', device: { label: 'synthetic-edge' }, detector: detectorOptions(),
        validity: { profile: 'development' },
      },
    );
    expect(result.validity.status).toBe('provisional');
    expect(result.validity.findings.find((finding) => finding.code === 'media_hash_missing')?.severity).toBe('warning');
  });

  it('uses externally computed file hashes and preserves verified manifest identity', async () => {
    const result = await runExternalCandidateBenchmarkSession(
      OPENCV_SSD_MOBILENET_V2_COCO_2026JUL, artifact(), diagnostic(), sequence(), provider,
      {
        runId: 'run-external-hashes', device: { label: 'synthetic-edge' },
        corpusHashes: { annotationSha256: HASH_C, mediaSha256: HASH_D },
        manifestIdentity: validationManifestIdentity,
        detector: detectorOptions(), validity: { profile: 'selection' },
      },
    );
    expect(result.report.corpus.annotationSha256).toBe(HASH_C);
    expect(result.report.corpus.mediaSha256).toBe(HASH_D);
    expect(result.report.corpus.manifest).toEqual(validationManifestIdentity);
    expect(result.report.notes).toContain('corpus_manifest_sha256_source:externally_computed_file_bytes');
    expect(result.validity.status).toBe('valid');
  });
});
