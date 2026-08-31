import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import * as ort from 'onnxruntime-web';
import { OPENCV_SSD_MOBILENET_V2_COCO_2026JUL } from '../../src/detection/modelCandidates';
import { assessCandidateProbeCompatibility } from '../../src/detection/onnx/candidateProbeCompatibility';
import type { OnnxModelProbeResult } from '../../src/detection/onnx/modelProbe';
import {
  buildOnnxCandidateProbeDiagnosticRecord,
  serializeOnnxCandidateProbeDiagnosticRecord,
} from '../../src/detection/onnx/probeDiagnostic';
import { buildOnnxProbeRecord } from '../../src/detection/onnx/probeRecord';
import type { OnnxRuntimeSmokeEvidence } from '../../src/detection/onnx/runtimeSmoke';
import { verifyCandidateProbeDiagnostic } from '../../src/detection/onnx/probeVerification';
import type { OnnxValueMetadata } from '../../src/detection/onnx/runtime';

const outputPath = 'artifacts/opencv-ssd-probe.json';

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function metadata(values: readonly ort.InferenceSession.ValueMetadata[]): OnnxValueMetadata[] {
  return values.map((value) => value.isTensor
    ? {
        name: value.name,
        kind: 'tensor',
        type: String(value.type),
        shape: [...value.shape],
      }
    : {
        name: value.name,
        kind: 'non_tensor',
      });
}

function tensorObservation(name: string, value: ort.Tensor): OnnxRuntimeSmokeEvidence['outputs'][number] {
  return {
    name,
    type: value.type,
    shape: [...value.dims],
    dataLength: value.data.length,
  };
}

function containsNonFinite(value: ort.Tensor): boolean {
  if (!(value.data instanceof Float32Array) && !(value.data instanceof Float64Array)) return false;
  return value.data.some((item) => !Number.isFinite(item));
}

describe('OpenCV SSD external checkpoint evidence', () => {
  it('verifies artifact identity and executes the SSD runtime contract', async () => {
    const candidate = OPENCV_SSD_MOBILENET_V2_COCO_2026JUL;
    const response = await fetch(candidate.artifact.url, { redirect: 'follow' });
    expect(response.ok, `download HTTP ${response.status}`).toBe(true);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const digest = sha256(bytes);
    expect(digest).toBe(candidate.artifact.sha256);

    ort.env.wasm.numThreads = 1;
    const session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
    try {
      const probe: OnnxModelProbeResult = {
        runtime: {
          runtime: 'onnxruntime-web',
          runtimeVersion: '1.29.0',
          backend: 'wasm',
          executionProviders: ['wasm'],
        },
        webgpuAttempted: false,
        inputs: metadata(session.inputMetadata),
        outputs: metadata(session.outputMetadata),
      };

      const inputName = 'image_tensor:0';
      const inputShape = [1, 300, 300, 3] as const;
      const input = new ort.Tensor('uint8', new Uint8Array(300 * 300 * 3), [...inputShape]);
      const rawOutputs = await session.run({ [inputName]: input });
      try {
        const findings: string[] = [];
        const outputEntries = Object.entries(rawOutputs);
        for (const [name, value] of outputEntries) {
          if (containsNonFinite(value)) findings.push(`non_finite_output:${name}`);
        }
        const smoke: OnnxRuntimeSmokeEvidence = {
          schemaVersion: '1',
          attempted: true,
          passed: findings.length === 0,
          input: { name: inputName, type: 'uint8', shape: [...inputShape] },
          outputs: outputEntries.map(([name, value]) => tensorObservation(name, value)),
          findings,
        };

        const record = buildOnnxProbeRecord(
          candidate,
          { sha256: digest, sizeBytes: bytes.byteLength },
          probe,
        );
        record.runtimeSmoke = smoke;
        const compatibility = assessCandidateProbeCompatibility(candidate, probe, smoke);
        const diagnostic = buildOnnxCandidateProbeDiagnosticRecord(record, compatibility);
        const verification = verifyCandidateProbeDiagnostic(candidate, diagnostic);

        expect(compatibility.status).toBe('compatible');
        expect(verification.status).toBe('verified');
        expect(verification.findings).toEqual([]);
        expect(smoke.outputs.find((value) => value.name === 'detection_boxes:0')?.shape).toEqual([1, 100, 4]);
        expect(smoke.outputs.find((value) => value.name === 'detection_scores:0')?.shape).toEqual([1, 100]);
        expect(smoke.outputs.find((value) => value.name === 'detection_classes:0')?.shape).toEqual([1, 100]);
        expect(smoke.outputs.find((value) => value.name === 'num_detections:0')?.shape).toEqual([1]);

        await mkdir('artifacts', { recursive: true });
        await writeFile(outputPath, serializeOnnxCandidateProbeDiagnosticRecord(diagnostic), 'utf8');
      } finally {
        input.dispose();
        await Promise.all(Object.values(rawOutputs).map(async (value) => value.dispose()));
      }
    } finally {
      await session.release();
    }
  }, 120_000);
});
