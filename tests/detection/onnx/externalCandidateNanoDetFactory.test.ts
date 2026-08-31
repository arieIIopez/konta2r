import { describe, expect, it } from 'vitest';
import evidenceText from '../../../docs/benchmarks/evidence/opencv-nanodet-m-plus-1.5x-416-2022nov-probe.json?raw';
import { OPENCV_NANODET_M_PLUS_1_5X_416 } from '../../../src/detection/modelCandidates';
import { buildExternalCandidateDetector } from '../../../src/detection/onnx/externalCandidateDetectorFactory';
import type { VerifiedOnnxArtifact } from '../../../src/detection/onnx/modelArtifact';
import { calculateNanoDetLetterboxTransform } from '../../../src/detection/onnx/nanodetPlus';
import { parseOnnxCandidateProbeDiagnosticJson } from '../../../src/detection/onnx/probeDiagnosticParser';
import type {
  OnnxExecutionProvider,
  OnnxModelSource,
  OnnxSessionFactory,
  OnnxSessionLike,
  OnnxValueMap,
} from '../../../src/detection/onnx/runtime';

function setDistributionPeak(values: Float32Array, location: number, side: number, bin: number): void {
  const base = (location * 32) + (side * 8);
  for (let index = 0; index < 8; index += 1) values[base + index] = -20;
  values[base + bin] = 20;
}

function syntheticOutputs(): OnnxValueMap {
  const classes32 = new Float32Array(169 * 80);
  const boxes32 = new Float32Array(169 * 32);
  const location = (6 * 13) + 6;
  classes32[(location * 80) + 1] = 0.2;
  for (let side = 0; side < 4; side += 1) setDistributionPeak(boxes32, location, side, 1);
  return {
    '792': { data: new Float32Array(2704 * 80) },
    '795': { data: new Float32Array(2704 * 32) },
    '814': { data: new Float32Array(676 * 80) },
    '817': { data: new Float32Array(676 * 32) },
    '836': { data: classes32 },
    '839': { data: boxes32 },
  };
}

class NanoSession implements OnnxSessionLike {
  releaseCount = 0;
  lastFeeds: OnnxValueMap | null = null;

  async run(feeds: OnnxValueMap): Promise<OnnxValueMap> {
    this.lastFeeds = feeds;
    return syntheticOutputs();
  }

  release(): void { this.releaseCount += 1; }
}

class NanoFactory implements OnnxSessionFactory {
  readonly session = new NanoSession();
  sources: OnnxModelSource[] = [];
  providers: readonly OnnxExecutionProvider[] = [];

  async create(source: OnnxModelSource, providers: readonly OnnxExecutionProvider[]): Promise<OnnxSessionLike> {
    this.sources.push(source);
    this.providers = providers;
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

describe('external NanoDet candidate factory', () => {
  it('builds, initializes and decodes NanoDet only from committed verified evidence', async () => {
    const factory = new NanoFactory();
    const verifiedArtifact = artifact();
    const diagnostic = parseOnnxCandidateProbeDiagnosticJson(evidenceText);
    const transform = calculateNanoDetLetterboxTransform(1_000, 500);
    const built = buildExternalCandidateDetector(
      OPENCV_NANODET_M_PLUS_1_5X_416,
      verifiedArtifact,
      diagnostic,
      {
        capabilities: { webgpu: false },
        sessionFactory: factory,
        minConfidence: 0.15,
        nanodetRgbLetterbox: () => ({
          rgb: new Uint8Array(416 * 416 * 3),
          transform,
        }),
      },
    );

    expect(built.probeVerified).toBe(true);
    expect(built.redistributionVerified).toBe(false);
    expect(built.model.adapterId).toBe('nanodet_plus_gfl');
    expect(built.model.modelId).toBe(OPENCV_NANODET_M_PLUS_1_5X_416.id);
    expect(built.model.classNames).toContain('person');
    expect(built.model.classNames).toContain('bicycle');

    const initialized = await built.detector.initialize();
    expect(initialized.runtime.backend).toBe('wasm');
    expect(factory.providers).toEqual(['wasm']);
    expect(factory.sources[0]).toBe(verifiedArtifact.bytes);

    const output = await built.detector.detect({
      source: {} as CanvasImageSource,
      sourceWidth: 1_000,
      sourceHeight: 500,
      timestampMs: 12_345,
    });
    expect(output.detections).toHaveLength(1);
    expect(output.detections[0]).toMatchObject({
      classId: 1,
      className: 'bicycle',
      confidence: expect.closeTo(0.2, 5),
    });
    expect(output.telemetry.detectionCountBeforeFiltering).toBe(1);
    expect(output.telemetry.detectionCount).toBe(1);

    const feed = factory.session.lastFeeds?.['input.1'] as { type?: string; dims?: readonly number[] } | undefined;
    expect(feed?.type).toBe('float32');
    expect(feed?.dims).toEqual([1, 3, 416, 416]);

    await built.detector.dispose();
    expect(factory.session.releaseCount).toBe(1);
  });

  it('rejects a NanoDet diagnostic whose checkpoint hash is altered', () => {
    const diagnostic = parseOnnxCandidateProbeDiagnosticJson(evidenceText);
    diagnostic.probe.artifact.sha256 = 'b'.repeat(64);
    expect(() => buildExternalCandidateDetector(
      OPENCV_NANODET_M_PLUS_1_5X_416,
      artifact(),
      diagnostic,
      {
        nanodetRgbLetterbox: () => ({
          rgb: new Uint8Array(416 * 416 * 3),
          transform: calculateNanoDetLetterboxTransform(416, 416),
        }),
      },
    )).toThrow('not technically verified: rejected');
  });
});
