import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import * as ort from 'onnxruntime-web';
import { OPENCV_NANODET_M_PLUS_1_5X_416 } from '../../src/detection/modelCandidates';

const outputPath = 'artifacts/opencv-nanodet-probe.json';

interface TensorMetadataEvidence {
  name: string;
  kind: 'tensor' | 'non_tensor';
  type?: string;
  shape?: Array<number | string>;
}

interface RuntimeTensorEvidence {
  name: string;
  type: string;
  shape: number[];
  dataLength: number;
  containsNonFinite: boolean;
}

interface NanoDetProbeEvidence {
  schemaVersion: '1';
  candidateId: string;
  observedAtIso: string;
  artifact: {
    sha256: string;
    sizeBytes: number;
  };
  runtime: {
    name: 'onnxruntime-web';
    version: '1.29.0';
    executionProvider: 'wasm';
  };
  inputs: TensorMetadataEvidence[];
  outputs: TensorMetadataEvidence[];
  smoke: {
    attempted: boolean;
    passed: boolean;
    input?: {
      name: string;
      type: string;
      shape: number[];
    };
    outputs: RuntimeTensorEvidence[];
    inferenceMs?: number;
    findings: string[];
  };
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function metadata(values: readonly ort.InferenceSession.ValueMetadata[]): TensorMetadataEvidence[] {
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

function staticNumericShape(value: ort.InferenceSession.ValueMetadata): number[] | null {
  if (!value.isTensor) return null;
  const dims = [...value.shape];
  if (!dims.every((dimension) => typeof dimension === 'number' && Number.isInteger(dimension) && dimension > 0)) {
    return null;
  }
  return dims as number[];
}

function tensorLength(shape: readonly number[]): number {
  return shape.reduce((product, dimension) => product * dimension, 1);
}

function buildZeroTensor(type: string, shape: number[]): ort.Tensor | null {
  const length = tensorLength(shape);
  if (type === 'float32') return new ort.Tensor('float32', new Float32Array(length), shape);
  if (type === 'float64') return new ort.Tensor('float64', new Float64Array(length), shape);
  if (type === 'uint8') return new ort.Tensor('uint8', new Uint8Array(length), shape);
  if (type === 'int8') return new ort.Tensor('int8', new Int8Array(length), shape);
  return null;
}

function runtimeTensorEvidence(name: string, value: ort.Tensor): RuntimeTensorEvidence {
  const data = value.data;
  const containsNonFinite = (
    data instanceof Float32Array || data instanceof Float64Array
  ) ? data.some((item) => !Number.isFinite(item)) : false;
  return {
    name,
    type: value.type,
    shape: [...value.dims],
    dataLength: data.length,
    containsNonFinite,
  };
}

describe('OpenCV NanoDet external checkpoint evidence', () => {
  it('verifies artifact identity and records the observed ONNX runtime contract', async () => {
    const candidate = OPENCV_NANODET_M_PLUS_1_5X_416;
    const response = await fetch(candidate.artifact.url, { redirect: 'follow' });
    expect(response.ok, `download HTTP ${response.status}`).toBe(true);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const digest = sha256(bytes);

    expect(digest).toBe(candidate.artifact.sha256);
    expect(bytes.byteLength).toBe(3_800_954);

    ort.env.wasm.numThreads = 1;
    const session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
    try {
      const inputs = metadata(session.inputMetadata);
      const outputs = metadata(session.outputMetadata);
      const findings: string[] = [];
      const runtimeOutputs: RuntimeTensorEvidence[] = [];
      let smokeInput: NanoDetProbeEvidence['smoke']['input'];
      let inferenceMs: number | undefined;
      let attempted = false;
      let passed = false;

      const singleInput = session.inputMetadata.length === 1 ? session.inputMetadata[0] : undefined;
      if (!singleInput) {
        findings.push(`expected_single_input:observed_${session.inputMetadata.length}`);
      } else if (!singleInput.isTensor) {
        findings.push('input_is_not_tensor');
      } else {
        const shape = staticNumericShape(singleInput);
        if (!shape) {
          findings.push('input_shape_is_not_static_numeric');
        } else {
          const tensor = buildZeroTensor(String(singleInput.type), shape);
          if (!tensor) {
            findings.push(`unsupported_smoke_input_type:${String(singleInput.type)}`);
          } else {
            attempted = true;
            smokeInput = { name: singleInput.name, type: String(singleInput.type), shape };
            const started = performance.now();
            const result = await session.run({ [singleInput.name]: tensor });
            inferenceMs = performance.now() - started;
            try {
              for (const [name, value] of Object.entries(result)) {
                runtimeOutputs.push(runtimeTensorEvidence(name, value));
              }
              for (const output of runtimeOutputs) {
                if (output.containsNonFinite) findings.push(`non_finite_output:${output.name}`);
              }
              passed = findings.length === 0 && runtimeOutputs.length > 0;
            } finally {
              tensor.dispose();
              await Promise.all(Object.values(result).map(async (value) => value.dispose()));
            }
          }
        }
      }

      const evidence: NanoDetProbeEvidence = {
        schemaVersion: '1',
        candidateId: candidate.id,
        observedAtIso: new Date().toISOString(),
        artifact: {
          sha256: digest,
          sizeBytes: bytes.byteLength,
        },
        runtime: {
          name: 'onnxruntime-web',
          version: '1.29.0',
          executionProvider: 'wasm',
        },
        inputs,
        outputs,
        smoke: {
          attempted,
          passed,
          ...(smokeInput === undefined ? {} : { input: smokeInput }),
          outputs: runtimeOutputs,
          ...(inferenceMs === undefined ? {} : { inferenceMs }),
          findings,
        },
      };

      await mkdir('artifacts', { recursive: true });
      await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');

      expect(inputs.length).toBeGreaterThan(0);
      expect(outputs.length).toBeGreaterThan(0);
      expect(attempted).toBe(true);
      expect(passed).toBe(true);
    } finally {
      await session.release();
    }
  }, 120_000);
});
