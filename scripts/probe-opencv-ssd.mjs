import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import * as ort from 'onnxruntime-web';

const candidate = {
  id: 'opencv-ssd-mobilenet-v2-coco-2026jul',
  displayName: 'SSD MobileNet V2 COCO — OpenCV contribution 2026-07',
  codecId: 'ssd_tf_object_detection',
  url: 'https://huggingface.co/opencv/opencv_contribution/resolve/main/ssd_mobilenet_v2_coco_2018_03_29/ssd_mobilenet_v2_coco_2018_03_29_2026jul.onnx',
  sha256: '7ba2fdaa87b8cbbb52c16b5c6e31a7452c00e8ad68aec580bfb7b07f5b212619',
  declaredLicense: 'Apache-2.0',
  redistributionVerified: false,
  expectedWidth: 300,
  expectedHeight: 300,
};

const outputPath = process.env.PROBE_OUTPUT ?? 'artifacts/opencv-ssd-probe.json';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function metadata(values) {
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

function classifyMetadata(inputs, outputs) {
  const all = [...inputs, ...outputs];
  if (all.length === 0) return 'empty';
  if (all.every((value) => value.kind === 'unknown')) return 'names_only';
  const tensors = all.filter((value) => value.kind === 'tensor');
  if (tensors.length === all.length && tensors.every((value) => value.type !== undefined && value.shape !== undefined)) {
    return 'complete';
  }
  return 'partial';
}

function metadataByName(values, name) {
  return values.find((value) => value.name === name);
}

function exactNumericShape(shape, expected) {
  return Array.isArray(shape)
    && shape.length === expected.length
    && shape.every((value, index) => typeof value === 'number' && value === expected[index]);
}

function numericType(value) {
  return value === undefined || [
    'float32', 'float64', 'int8', 'uint8', 'int16', 'uint16',
    'int32', 'uint32', 'int64', 'uint64',
  ].includes(value);
}

function assessSsdContract(inputs, outputs) {
  const contract = {
    inputName: 'image_tensor:0',
    boxes: 'detection_boxes:0',
    scores: 'detection_scores:0',
    classes: 'detection_classes:0',
    numDetections: 'num_detections:0',
  };
  const errors = [];
  const warnings = [];
  const input = metadataByName(inputs, contract.inputName);
  if (!input) {
    errors.push(`missing_input:${contract.inputName}`);
  } else {
    if (input.kind !== 'tensor') errors.push(`input_not_tensor:${contract.inputName}`);
    const type = input.type?.trim().toLowerCase();
    if (type !== 'uint8') errors.push(`input_type_expected_uint8:${type ?? 'unknown'}`);
    if (!exactNumericShape(input.shape, [1, 300, 300, 3])) {
      errors.push(`input_shape_mismatch:${input.shape?.join('x') ?? 'unknown'}`);
    }
  }
  for (const [role, name] of [
    ['boxes', contract.boxes],
    ['scores', contract.scores],
    ['classes', contract.classes],
    ['numDetections', contract.numDetections],
  ]) {
    const item = metadataByName(outputs, name);
    if (!item) {
      errors.push(`missing_output_${role}:${name}`);
      continue;
    }
    if (item.kind !== 'tensor') errors.push(`output_not_tensor_${role}:${name}`);
    const type = item.type?.trim().toLowerCase();
    if (!numericType(type)) errors.push(`output_not_numeric_${role}:${type ?? 'unknown'}`);
  }
  const boxes = metadataByName(outputs, contract.boxes);
  if (boxes?.shape && boxes.shape.length >= 1) {
    const finalDimension = boxes.shape.at(-1);
    if (typeof finalDimension === 'number' && finalDimension !== 4) {
      errors.push(`boxes_last_dimension_expected_4:${finalDimension}`);
    }
  } else if (boxes) {
    warnings.push('boxes_shape_not_reported');
  }
  const scores = metadataByName(outputs, contract.scores);
  const classes = metadataByName(outputs, contract.classes);
  if (scores?.shape && classes?.shape && JSON.stringify(scores.shape) !== JSON.stringify(classes.shape)) {
    warnings.push('scores_classes_shapes_differ');
  }
  return {
    schemaVersion: '1',
    candidateId: candidate.id,
    codecId: candidate.codecId,
    status: errors.length === 0 ? 'compatible' : 'incompatible',
    errors,
    warnings,
  };
}

function tensorRuntimeSummary(name, tensor) {
  return {
    name,
    type: String(tensor.type),
    shape: [...tensor.dims],
    dataLength: tensor.data.length,
  };
}

function finiteTensorData(tensor) {
  for (let index = 0; index < tensor.data.length; index += 1) {
    if (!Number.isFinite(Number(tensor.data[index]))) return false;
  }
  return true;
}

async function runtimeSmokeInference(session) {
  const inputName = 'image_tensor:0';
  const inputShape = [1, candidate.expectedHeight, candidate.expectedWidth, 3];
  const input = new ort.Tensor(
    'uint8',
    new Uint8Array(candidate.expectedWidth * candidate.expectedHeight * 3),
    inputShape,
  );
  let outputs;
  try {
    const startedAt = performance.now();
    outputs = await session.run({ [inputName]: input });
    const elapsedMs = performance.now() - startedAt;
    const boxes = outputs['detection_boxes:0'];
    const scores = outputs['detection_scores:0'];
    const classes = outputs['detection_classes:0'];
    const num = outputs['num_detections:0'];
    if (!boxes || !scores || !classes || !num) {
      throw new Error('smoke_inference_missing_expected_output');
    }
    const declaredCount = Number(num.data[0]);
    const availableBoxes = Math.floor(boxes.data.length / 4);
    const availableScores = scores.data.length;
    const availableClasses = classes.data.length;
    const invariants = {
      inputAcceptedAt300x300: true,
      boxesLastDimension4: boxes.dims.at(-1) === 4,
      scoresClassesDataLengthMatch: availableScores === availableClasses,
      numDetectionsFinite: Number.isFinite(declaredCount),
      numDetectionsWithinAvailableOutputs:
        Number.isFinite(declaredCount)
        && declaredCount >= 0
        && declaredCount <= Math.min(availableBoxes, availableScores, availableClasses),
      boxesFinite: finiteTensorData(boxes),
      scoresFinite: finiteTensorData(scores),
      classesFinite: finiteTensorData(classes),
    };
    return {
      schemaVersion: '1',
      input: { name: inputName, type: 'uint8', shape: inputShape },
      outputs: Object.entries(outputs).map(([name, tensor]) => tensorRuntimeSummary(name, tensor)),
      declaredNumDetections: declaredCount,
      elapsedMs,
      invariants,
      passed: Object.values(invariants).every(Boolean),
    };
  } finally {
    input.dispose();
    if (outputs) {
      for (const tensor of Object.values(outputs)) tensor.dispose();
    }
  }
}

async function main() {
  console.log(`Downloading ${candidate.id}...`);
  const response = await fetch(candidate.url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`download_failed:${response.status}`);
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const digest = sha256(bytes);
  console.log(`Downloaded ${bytes.byteLength} bytes; sha256=${digest}`);
  if (digest !== candidate.sha256) {
    throw new Error(`sha256_mismatch:expected=${candidate.sha256}:received=${digest}`);
  }

  ort.env.wasm.numThreads = 1;
  const session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
  try {
    const inputs = metadata(session.inputMetadata);
    const outputs = metadata(session.outputMetadata);
    const observed = inputs.find((value) => value.kind === 'tensor' && value.shape !== undefined)?.shape;
    const numericDimensions = observed?.filter((value) => typeof value === 'number') ?? [];
    const dimensionsMatch = observed
      ? numericDimensions.includes(candidate.expectedWidth) && numericDimensions.includes(candidate.expectedHeight)
      : undefined;
    const compatibility = assessSsdContract(inputs, outputs);
    console.log('Running zero-frame smoke inference at [1,300,300,3]...');
    const runtimeValidation = await runtimeSmokeInference(session);
    console.log(`smoke=${runtimeValidation.passed}; outputs=${JSON.stringify(runtimeValidation.outputs)}`);
    const probedAtIso = new Date().toISOString();
    const record = {
      schemaVersion: '1',
      recordType: 'onnx_candidate_probe_diagnostic',
      probe: {
        schemaVersion: '1.0',
        recordType: 'onnx_model_probe',
        candidateId: candidate.id,
        candidateDisplayName: candidate.displayName,
        artifact: {
          sourceUrl: candidate.url,
          sha256: digest,
          sizeBytes: bytes.byteLength,
          declaredLicense: candidate.declaredLicense,
          redistributionVerified: candidate.redistributionVerified,
        },
        probedAtIso,
        runtime: {
          runtime: 'onnxruntime-web',
          runtimeVersion: '1.29.0',
          backend: 'wasm',
          executionProviders: ['wasm'],
        },
        webgpuAttempted: false,
        inputs,
        outputs,
        metadataCompleteness: classifyMetadata(inputs, outputs),
        inputHintAssessment: {
          expectedWidth: candidate.expectedWidth,
          expectedHeight: candidate.expectedHeight,
          expectedLayout: 'NHWC',
          ...(observed === undefined ? {} : { observedShape: [...observed] }),
          ...(dimensionsMatch === undefined ? {} : { dimensionsMatch }),
        },
      },
      codecCompatibility: compatibility,
      runtimeValidation,
    };

    await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    console.log(`Diagnostic written to ${outputPath}`);
    console.log(`metadata=${record.probe.metadataCompleteness}; codec=${compatibility.status}; smoke=${runtimeValidation.passed}`);
    if (record.probe.metadataCompleteness !== 'complete' || compatibility.status !== 'compatible' || !runtimeValidation.passed) {
      process.exitCode = 2;
    }
  } finally {
    await session.release();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
