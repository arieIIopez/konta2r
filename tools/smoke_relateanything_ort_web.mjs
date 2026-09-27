#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import * as ort from 'onnxruntime-web';

const [
  modelPath,
  bankPath,
  thresholdsPath,
  calibrationPath,
  releaseFetchPath,
  outputPath = 'docs/benchmarks/evidence/relateanything-vits16-ort-web-wasm-smoke.json',
] = process.argv.slice(2);

if (!modelPath || !bankPath || !thresholdsPath || !calibrationPath || !releaseFetchPath) {
  throw new Error(
    'Usage: smoke_relateanything_ort_web.mjs <model.onnx> <bank.json> <thresholds.json> <calibration.json> <release-fetch.json> [output.json]',
  );
}

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function tensorMetadata(value) {
  return {
    name: value.name,
    kind: value.isTensor ? 'tensor' : 'non_tensor',
    ...(value.isTensor ? { type: String(value.type), shape: [...value.shape] } : {}),
  };
}

function outputObservation(name, value) {
  if (!value || typeof value !== 'object') {
    throw new Error(`missing runtime output ${name}`);
  }
  const shape = Array.isArray(value.dims) ? [...value.dims] : [];
  const data = value.data;
  const dataLength = data && typeof data.length === 'number' ? data.length : -1;
  let finiteCount = 0;
  let nonFiniteCount = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  if (data && typeof data.length === 'number') {
    for (let index = 0; index < data.length; index += 1) {
      const raw = data[index];
      const numeric = typeof raw === 'bigint' ? Number(raw) : Number(raw);
      if (Number.isFinite(numeric)) {
        finiteCount += 1;
        min = Math.min(min, numeric);
        max = Math.max(max, numeric);
      } else {
        nonFiniteCount += 1;
      }
    }
  }

  return {
    name,
    type: String(value.type ?? 'unknown'),
    shape,
    dataLength,
    finiteCount,
    nonFiniteCount,
    min: finiteCount > 0 ? min : null,
    max: finiteCount > 0 ? max : null,
  };
}

function artifactRecord(path, bytes) {
  return {
    path,
    sha256: hash(bytes),
    sizeBytes: bytes.byteLength,
  };
}

function releaseArtifact(fetchManifest, name) {
  return fetchManifest.artifacts?.find((item) => item.name === name);
}

function localExternalData(fetchManifest) {
  const names = new Set(fetchManifest.externalDataCandidates ?? []);
  return (fetchManifest.artifacts ?? []).filter((item) => names.has(item.name));
}

function expectedInputFindings(session) {
  const expected = new Map([
    ['image', { type: 'float32', rank: 4, fixed: new Map([[1, 3], [2, 448], [3, 448]]) }],
    ['boxes', { type: 'float32', rank: 3, fixed: new Map([[2, 4]]) }],
    ['box_counts', { type: 'int64', rank: 1, fixed: new Map() }],
    ['W', { type: 'float32', rank: 2, fixed: new Map([[1, 512]]) }],
    ['alpha', { type: 'float32', rank: 1, fixed: new Map() }],
  ]);
  const findings = [];

  for (const name of expected.keys()) {
    if (!session.inputNames.includes(name)) findings.push(`missing_expected_input:${name}`);
  }
  for (const name of session.inputNames) {
    if (!expected.has(name)) findings.push(`unexpected_input:${name}`);
  }

  for (const metadata of session.inputMetadata) {
    const contract = expected.get(metadata.name);
    if (!contract || !metadata.isTensor) continue;
    if (String(metadata.type) !== contract.type) {
      findings.push(`unexpected_input_type:${metadata.name}:${metadata.type}`);
    }
    if (metadata.shape.length !== contract.rank) {
      findings.push(
        `unexpected_input_rank:${metadata.name}:${metadata.shape.join('x')}`,
      );
      continue;
    }
    for (const [index, expectedDimension] of contract.fixed) {
      if (metadata.shape[index] !== expectedDimension) {
        findings.push(
          `unexpected_input_dimension:${metadata.name}:${index}:${metadata.shape[index]}:${expectedDimension}`,
        );
      }
    }
  }
  return findings;
}

async function externalDataEntries(fetchManifest, prefix = '') {
  const entries = [];
  for (const artifact of localExternalData(fetchManifest)) {
    const bytes = new Uint8Array(await readFile(artifact.localPath));
    entries.push({
      path: `${prefix}${artifact.name}`,
      data: bytes,
    });
  }
  return entries;
}

async function createSession(modelBytes, fetchManifest) {
  const attempts = [];
  const candidates = fetchManifest.externalDataCandidates ?? [];
  const variants = candidates.length === 0
    ? [{ label: 'single_file', externalData: undefined }]
    : [
        {
          label: 'external_data_exact_path',
          externalData: await externalDataEntries(fetchManifest, ''),
        },
        {
          label: 'external_data_dot_slash_path',
          externalData: await externalDataEntries(fetchManifest, './'),
        },
      ];

  let lastError;
  for (const variant of variants) {
    const startedAt = performance.now();
    try {
      const session = await ort.InferenceSession.create(modelBytes, {
        executionProviders: ['wasm'],
        ...(variant.externalData === undefined ? {} : { externalData: variant.externalData }),
      });
      attempts.push({
        label: variant.label,
        passed: true,
        durationMs: Math.max(0, performance.now() - startedAt),
        externalDataPaths: variant.externalData?.map((item) => item.path) ?? [],
      });
      return { session, attempts, selectedAttempt: variant.label };
    } catch (error) {
      lastError = error;
      attempts.push({
        label: variant.label,
        passed: false,
        durationMs: Math.max(0, performance.now() - startedAt),
        externalDataPaths: variant.externalData?.map((item) => item.path) ?? [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  throw Object.assign(
    new Error(
      `Unable to create RelateAnything ONNX Runtime Web session: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    ),
    { sessionAttempts: attempts },
  );
}

function makeFeeds(bank) {
  const vocabularySize = bank.names.length;
  if (!Number.isInteger(bank.dim) || bank.dim <= 0) throw new Error('bank.dim is invalid');
  if (!Array.isArray(bank.W) || bank.W.length !== vocabularySize) {
    throw new Error('bank.W row count does not match names');
  }
  if (!Array.isArray(bank.alpha) || bank.alpha.length !== vocabularySize) {
    throw new Error('bank.alpha length does not match names');
  }

  const flattenedW = new Float32Array(vocabularySize * bank.dim);
  bank.W.forEach((row, rowIndex) => {
    if (!Array.isArray(row) || row.length !== bank.dim) {
      throw new Error(`bank.W row ${rowIndex} has invalid dimension`);
    }
    flattenedW.set(row, rowIndex * bank.dim);
  });

  const image = new Float32Array(1 * 3 * 448 * 448);
  image.fill(0.5);

  const boxes = new Float32Array(1 * 32 * 4);
  // Two plausible image-space regions in normalized cx/cy/w/h.
  boxes.set([0.35, 0.5, 0.18, 0.55], 0);
  boxes.set([0.52, 0.68, 0.42, 0.18], 4);

  return {
    image: new ort.Tensor('float32', image, [1, 3, 448, 448]),
    boxes: new ort.Tensor('float32', boxes, [1, 32, 4]),
    box_counts: new ort.Tensor('int64', BigInt64Array.from([2n]), [1]),
    W: new ort.Tensor('float32', flattenedW, [vocabularySize, bank.dim]),
    alpha: new ort.Tensor(
      'float32',
      Float32Array.from(bank.alpha.map((value) => Number(value))),
      [vocabularySize],
    ),
  };
}

async function main() {
  const modelBytes = new Uint8Array(await readFile(modelPath));
  const bankBytes = new Uint8Array(await readFile(bankPath));
  const thresholdsBytes = new Uint8Array(await readFile(thresholdsPath));
  const calibrationBytes = new Uint8Array(await readFile(calibrationPath));
  const releaseFetchBytes = new Uint8Array(await readFile(releaseFetchPath));

  const bank = JSON.parse(new TextDecoder().decode(bankBytes));
  const thresholds = JSON.parse(new TextDecoder().decode(thresholdsBytes));
  const calibration = JSON.parse(new TextDecoder().decode(calibrationBytes));
  const releaseFetch = JSON.parse(new TextDecoder().decode(releaseFetchBytes));
  let upstreamProvenanceContent = null;
  if (releaseFetch.provenance?.localPath) {
    try {
      upstreamProvenanceContent = JSON.parse(
        await readFile(releaseFetch.provenance.localPath, 'utf8'),
      );
    } catch {
      upstreamProvenanceContent = null;
    }
  }

  const findings = [];
  const memoryBefore = process.memoryUsage();
  let session = null;
  let sessionAttempts = [];
  let selectedSessionAttempt = null;
  let runtimeOutputs = [];
  let inferenceMs = null;
  let staticMetadata = null;
  let errorText = null;

  ort.env.wasm.numThreads = 1;

  try {
    const creation = await createSession(modelBytes, releaseFetch);
    session = creation.session;
    sessionAttempts = creation.attempts;
    selectedSessionAttempt = creation.selectedAttempt;

    staticMetadata = {
      inputs: session.inputMetadata.map(tensorMetadata),
      outputs: session.outputMetadata.map(tensorMetadata),
    };
    findings.push(...expectedInputFindings(session));

    if (bank.dim !== 512) findings.push(`unexpected_bank_dim:${bank.dim}`);
    for (const predicate of [
      'sitting on',
      'leaning against',
      'talking to',
      'riding',
      'holding',
    ]) {
      if (!bank.names.includes(predicate)) findings.push(`missing_smoke_predicate:${predicate}`);
    }

    const feeds = makeFeeds(bank);
    let outputs;
    const startedAt = performance.now();
    try {
      outputs = await session.run(feeds);
      inferenceMs = Math.max(0, performance.now() - startedAt);
    } finally {
      for (const tensor of Object.values(feeds)) tensor.dispose?.();
    }

    runtimeOutputs = session.outputNames.map((name) =>
      outputObservation(name, outputs[name]));

    const expectedOutputs = ['pred_logits', 'pair_logits', 'sub_idx', 'obj_idx', 'valid_mask'];
    for (const name of expectedOutputs) {
      if (!session.outputNames.includes(name)) findings.push(`missing_expected_output:${name}`);
    }
    for (const output of runtimeOutputs) {
      if (output.nonFiniteCount > 0) {
        findings.push(`non_finite_runtime_output:${output.name}:${output.nonFiniteCount}`);
      }
      const expectedLength = output.shape.length > 0
        ? output.shape.reduce((product, dimension) => product * Number(dimension), 1)
        : output.dataLength;
      if (output.dataLength !== expectedLength) {
        findings.push(
          `output_length_mismatch:${output.name}:${output.dataLength}:${expectedLength}`,
        );
      }
    }

    for (const value of Object.values(outputs)) value?.dispose?.();
  } catch (error) {
    errorText = error instanceof Error ? error.message : String(error);
    sessionAttempts = error?.sessionAttempts ?? sessionAttempts;
    findings.push(`runtime_error:${errorText}`);
  } finally {
    if (session) await session.release();
  }

  const memoryAfter = process.memoryUsage();
  const evidence = {
    schemaVersion: '1',
    recordType: 'relateanything_onnxruntime_web_wasm_smoke',
    candidateId: `${releaseFetch.modelRepo ?? 'unknown'}@${releaseFetch.modelRevision ?? 'unknown'}`,
    executedAtIso: new Date().toISOString(),
    sourceRevision: releaseFetch.modelRevision ?? null,
    artifacts: {
      model: {
        ...artifactRecord(modelPath, modelBytes),
        source: releaseArtifact(releaseFetch, 'relateanything.onnx') ?? null,
      },
      predicateBankSubset: artifactRecord(bankPath, bankBytes),
      predicateBankSource: releaseArtifact(releaseFetch, 'predicate_bank.npz') ?? null,
      thresholds: {
        ...artifactRecord(thresholdsPath, thresholdsBytes),
        source: releaseArtifact(releaseFetch, 'thresholds.json') ?? null,
      },
      calibration: {
        ...artifactRecord(calibrationPath, calibrationBytes),
        source: releaseArtifact(releaseFetch, 'calibration.json') ?? null,
      },
    },
    release: {
      modelRepo: releaseFetch.modelRepo,
      modelRevision: releaseFetch.modelRevision ?? null,
      modelLastModified: releaseFetch.modelLastModified ?? null,
      upstreamSiblingCount: releaseFetch.siblingCount,
      externalDataCandidates: releaseFetch.externalDataCandidates ?? [],
      upstreamProvenance: releaseFetch.provenance ?? null,
      upstreamProvenanceContent,
    },
    bank: {
      names: bank.names,
      indices: bank.indices,
      dim: bank.dim,
      sourceKeys: bank.sourceKeys,
      thresholdsFromBank: bank.thr,
    },
    thresholdsFileType: Array.isArray(thresholds) ? 'array' : typeof thresholds,
    calibration,
    environment: {
      nodeVersion: process.version,
      runtime: 'onnxruntime-web',
      configuredExecutionProviders: ['wasm'],
      wasmThreads: 1,
      platform: process.platform,
      arch: process.arch,
    },
    runtime: {
      attempted: true,
      passed: errorText === null && findings.length === 0,
      sessionAttempts,
      selectedSessionAttempt,
      staticMetadata,
      syntheticInput: {
        image: { type: 'float32', shape: [1, 3, 448, 448], fill: 0.5 },
        boxes: {
          type: 'float32',
          shape: [1, 32, 4],
          activeBoxCount: 2,
          coordinateFormat: 'normalized_cxcywh',
        },
        vocabularySize: bank.names.length,
      },
      outputs: runtimeOutputs,
      inferenceMs,
      findings,
      error: errorText,
    },
    memory: {
      before: memoryBefore,
      after: memoryAfter,
      deltaRssBytes: memoryAfter.rss - memoryBefore.rss,
      deltaExternalBytes: memoryAfter.external - memoryBefore.external,
    },
  };

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(evidence, null, 2));

  if (!evidence.runtime.passed) process.exitCode = 1;
}

await main();
