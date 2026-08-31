import { describe, expect, it } from 'vitest';
import { OPENCV_SSD_MOBILENET_V2_COCO_2026JUL } from '../../../src/detection/modelCandidates';
import { assessCandidateProbeCompatibility } from '../../../src/detection/onnx/candidateProbeCompatibility';
import { buildExternalCandidateDetector } from '../../../src/detection/onnx/externalCandidateDetectorFactory';
import type { VerifiedOnnxArtifact } from '../../../src/detection/onnx/modelArtifact';
import type { OnnxModelProbeResult } from '../../../src/detection/onnx/modelProbe';
import {
  buildOnnxCandidateProbeDiagnosticRecord,
  type OnnxCandidateProbeDiagnosticRecord,
} from '../../../src/detection/onnx/probeDiagnostic';
import { buildOnnxProbeRecord } from '../../../src/detection/onnx/probeRecord';
import type {
  OnnxExecutionProvider,
  OnnxModelSource,
  OnnxSessionFactory,
  OnnxSessionLike,
  OnnxValueMap,
} from '../../../src/detection/onnx/runtime';

function completeProbe(): OnnxModelProbeResult {
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

function diagnostic(probe: OnnxModelProbeResult = completeProbe()): OnnxCandidateProbeDiagnosticRecord {
  const candidate = OPENCV_SSD_MOBILENET_V2_COCO_2026JUL;
  return buildOnnxCandidateProbeDiagnosticRecord(
    buildOnnxProbeRecord(
      candidate,
      { sha256: candidate.artifact.sha256, sizeBytes: 4 },
      probe,
      new Date('2026-08-31T03:30:00.000Z'),
    ),
    assessCandidateProbeCompatibility(candidate, probe),
  );
}

function artifact(): VerifiedOnnxArtifact {
  return {
    bytes: new Uint8Array([1, 2, 3, 4]),
    sha256: OPENCV_SSD_MOBILENET_V2_COCO_2026JUL.artifact.sha256,
    sizeBytes: 4,
  };
}

class EmptySession implements OnnxSessionLike {
  releaseCount = 0;
  async run(_feeds: OnnxValueMap): Promise<OnnxValueMap> { return {}; }
  release(): void { this.releaseCount += 1; }
}

class EmptyFactory implements OnnxSessionFactory {
  readonly session = new EmptySession();
  sources: OnnxModelSource[] = [];
  async create(source: OnnxModelSource, _providers: readonly OnnxExecutionProvider[]): Promise<OnnxSessionLike> {
    this.sources.push(source);
    return this.session;
  }
}

describe('external candidate detector factory', () => {
  it('builds and initializes an experimental SSD detector only after technical probe verification', async () => {
    const factory = new EmptyFactory();
    const verifiedArtifact = artifact();
    const built = buildExternalCandidateDetector(
      OPENCV_SSD_MOBILENET_V2_COCO_2026JUL,
      verifiedArtifact,
      diagnostic(),
      {
        capabilities: { webgpu: false },
        sessionFactory: factory,
        ssdRgbResize: () => new Uint8Array(300 * 300 * 3),
      },
    );

    expect(built.probeVerified).toBe(true);
    expect(built.redistributionVerified).toBe(false);
    expect(built.model.modelId).toBe(OPENCV_SSD_MOBILENET_V2_COCO_2026JUL.id);
    expect(built.model.modelSha256).toBe(verifiedArtifact.sha256);
    expect(built.model.weightsLicense).toBeUndefined();
    expect(built.model.codeLicense).toBeUndefined();
    expect(built.model.weightsRedistributionVerified).toBe(false);
    expect(built.model.classNames).toContain('person');
    expect(built.model.classNames).toContain('bicycle');

    const initialized = await built.detector.initialize();
    expect(initialized.runtime.backend).toBe('wasm');
    expect(factory.sources).toHaveLength(1);
    expect(factory.sources[0]).toBe(verifiedArtifact.bytes);
    await built.detector.dispose();
    expect(factory.session.releaseCount).toBe(1);
  });

  it('rejects an artifact hash that differs from the registered candidate before detector construction', () => {
    const altered = artifact();
    altered.sha256 = 'b'.repeat(64);
    expect(() => buildExternalCandidateDetector(
      OPENCV_SSD_MOBILENET_V2_COCO_2026JUL,
      altered,
      diagnostic(),
    )).toThrow('hash does not match');
  });

  it('rejects inconsistent verified-artifact byte length', () => {
    const inconsistent = artifact();
    inconsistent.sizeBytes = 99;
    expect(() => buildExternalCandidateDetector(
      OPENCV_SSD_MOBILENET_V2_COCO_2026JUL,
      inconsistent,
      diagnostic(),
    )).toThrow('byte length is inconsistent');
  });

  it('rejects technically incomplete probe evidence before creating a codec', () => {
    const probe: OnnxModelProbeResult = {
      ...completeProbe(),
      inputs: [{ name: 'image_tensor:0', kind: 'unknown' }],
      outputs: [
        { name: 'detection_boxes:0', kind: 'unknown' },
        { name: 'detection_scores:0', kind: 'unknown' },
        { name: 'detection_classes:0', kind: 'unknown' },
        { name: 'num_detections:0', kind: 'unknown' },
      ],
    };

    expect(() => buildExternalCandidateDetector(
      OPENCV_SSD_MOBILENET_V2_COCO_2026JUL,
      artifact(),
      diagnostic(probe),
    )).toThrow('not technically verified: incomplete');
  });
});
