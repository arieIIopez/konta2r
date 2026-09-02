#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import * as ort from 'onnxruntime-web';

const MODEL_URL = 'https://github.com/opencv/opencv_zoo/raw/main/models/object_detection_nanodet/object_detection_nanodet_2022nov.onnx';
const EXPECTED_SHA256 = '4b82da9944b88577175ee23a459dce2e26e6e4be573def65b1055dc2d9720186';
const EXPECTED_SIZE = 3_800_954;
const OUTPUT_PATH = process.argv[2] ?? 'docs/benchmarks/evidence/nanodet-m-plus-1.5x-416-ort-web-wasm-smoke.json';

function tensorMetadata(value) {
  return {
    name: value.name,
    kind: value.isTensor ? 'tensor' : 'non_tensor',
    ...(value.isTensor ? { type: String(value.type), shape: [...value.shape] } : {}),
  };
}

function outputObservation(name, value) {
  if (!value || typeof value !== 'object') throw new Error(`missing runtime output ${name}`);
  const shape = Array.isArray(value.dims) ? [...value.dims] : [];
  const dataLength = value.data && typeof value.data.length === 'number' ? value.data.length : -1;
  return {
    name,
    type: String(value.type ?? 'unknown'),
    shape,
    dataLength,
  };
}

const response = await fetch(MODEL_URL, {
  headers: { 'user-agent': 'konta2r-onnxruntime-web-smoke/1.0' },
  redirect: 'follow',
});
if (!response.ok) throw new Error(`model download failed: HTTP ${response.status}`);
const bytes = new Uint8Array(await response.arrayBuffer());
const sha256 = createHash('sha256').update(bytes).digest('hex');
if (bytes.byteLength !== EXPECTED_SIZE) {
  throw new Error(`size mismatch: expected ${EXPECTED_SIZE}, observed ${bytes.byteLength}`);
}
if (sha256 !== EXPECTED_SHA256) {
  throw new Error(`sha256 mismatch: expected ${EXPECTED_SHA256}, observed ${sha256}`);
}

ort.env.wasm.numThreads = 1;
const session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
try {
  const inputs = session.inputMetadata.map(tensorMetadata);
  const outputsMetadata = session.outputMetadata.map(tensorMetadata);
  if (session.inputNames.length !== 1) throw new Error(`expected one input, observed ${session.inputNames.length}`);
  const inputName = session.inputNames[0];
  if (!inputName) throw new Error('input name missing');

  const inputData = new Float32Array(1 * 3 * 416 * 416);
  const inputTensor = new ort.Tensor('float32', inputData, [1, 3, 416, 416]);
  let outputs;
  try {
    outputs = await session.run({ [inputName]: inputTensor });
  } finally {
    inputTensor.dispose();
  }

  const runtimeOutputs = session.outputNames.map((name) => outputObservation(name, outputs[name]));
  for (const value of Object.values(outputs)) value?.dispose?.();

  const expectedShapes = new Map([
    [2704, new Set([80, 32])],
    [676, new Set([80, 32])],
    [169, new Set([80, 32])],
  ]);
  const findings = [];
  if (inputName !== 'input.1') findings.push(`unexpected_input_name:${inputName}`);
  if (runtimeOutputs.length !== 6) findings.push(`unexpected_output_count:${runtimeOutputs.length}`);
  for (const output of runtimeOutputs) {
    if (output.type !== 'float32') findings.push(`unexpected_output_type:${output.name}:${output.type}`);
    if (output.shape.length !== 3 || output.shape[0] !== 1) {
      findings.push(`unexpected_output_rank:${output.name}:${output.shape.join('x')}`);
      continue;
    }
    const locations = output.shape[1];
    const channels = output.shape[2];
    const allowedChannels = expectedShapes.get(locations);
    if (!allowedChannels?.has(channels)) {
      findings.push(`unexpected_output_shape:${output.name}:${output.shape.join('x')}`);
    }
    const expectedLength = output.shape.reduce((product, dimension) => product * dimension, 1);
    if (output.dataLength !== expectedLength) {
      findings.push(`output_length_mismatch:${output.name}:${output.dataLength}:${expectedLength}`);
    }
  }

  const evidence = {
    schemaVersion: '1',
    recordType: 'nanodet_onnxruntime_web_wasm_smoke',
    candidateId: 'opencv-nanodet-m-plus-1.5x-416-2022nov',
    artifact: {
      sourceUrl: MODEL_URL,
      sha256,
      sizeBytes: bytes.byteLength,
    },
    executedAtIso: new Date().toISOString(),
    environment: {
      nodeVersion: process.version,
      runtime: 'onnxruntime-web',
      configuredExecutionProviders: ['wasm'],
      wasmThreads: 1,
    },
    staticMetadata: { inputs, outputs: outputsMetadata },
    runtimeSmoke: {
      schemaVersion: '1',
      attempted: true,
      passed: findings.length === 0,
      input: { name: inputName, type: 'float32', shape: [1, 3, 416, 416] },
      outputs: runtimeOutputs,
      findings,
    },
  };

  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(evidence, null, 2));
  if (findings.length > 0) process.exitCode = 1;
} finally {
  await session.release();
}
