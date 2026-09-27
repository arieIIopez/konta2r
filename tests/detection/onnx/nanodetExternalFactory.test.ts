import { describe, expect, it } from 'vitest';
import evidenceText from '../../../docs/benchmarks/evidence/opencv-nanodet-m-plus-1.5x-416-2022nov-probe.json?raw';
import { OPENCV_NANODET_M_PLUS_1_5X_416 } from '../../../src/detection/modelCandidates';
import { buildExternalCandidateDetector } from '../../../src/detection/onnx/externalCandidateDetectorFactory';
import type { VerifiedOnnxArtifact } from '../../../src/detection/onnx/modelArtifact';
import { reviewImportedProbeDiagnostic } from '../../../src/detection/onnx/probeDiagnosticReview';
import type {
  OnnxExecutionProvider,
  OnnxModelSource,
  OnnxSessionFactory,
  OnnxSessionLike,
  OnnxValueMap,
} from '../../../src/detection/onnx/runtime';

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

function artifact(): VerifiedOnnxArtifact {
  return {
    bytes: new Uint8Array([1, 2, 3, 4]),
    sha256: OPENCV_NANODET_M_PLUS_1_5X_416.artifact.sha256,
    sizeBytes: 4,
  };
}

describe('verified NanoDet external factory', () => {
  it('constructs the eco candidate only through its committed verified diagnostic', async () => {
    const review = reviewImportedProbeDiagnostic(evidenceText);
    expect(review.verification.status).toBe('verified');
    const factory = new EmptyFactory();
    const verifiedArtifact = artifact();

    const built = buildExternalCandidateDetector(
      OPENCV_NANODET_M_PLUS_1_5X_416,
      verifiedArtifact,
      review.diagnostic,
      {
        capabilities: { webgpu: false },
        sessionFactory: factory,
        minConfidence: 0.05,
        nanodetRgbLetterbox: () => ({
          rgb: new Uint8Array(416 * 416 * 3),
          transform: {
            sourceWidth: 416, sourceHeight: 416,
            inputWidth: 416, inputHeight: 416,
            resizedWidth: 416, resizedHeight: 416,
            left: 0, top: 0,
          },
        }),
      },
    );

    expect(built.probeVerified).toBe(true);
    expect(built.model.adapterId).toBe('nanodet_plus_gfl');
    expect(built.model.modelId).toBe(OPENCV_NANODET_M_PLUS_1_5X_416.id);
    expect(built.model.inputWidth).toBe(416);
    expect(built.model.inputHeight).toBe(416);
    expect(built.model.classNames).toContain('person');
    expect(built.model.classNames).toContain('bicycle');
    expect(built.redistributionVerified).toBe(false);

    const initialized = await built.detector.initialize();
    expect(initialized.runtime.backend).toBe('wasm');
    expect(factory.sources[0]).toBe(verifiedArtifact.bytes);
    await built.detector.dispose();
    expect(factory.session.releaseCount).toBe(1);
  });
});
