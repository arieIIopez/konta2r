import type { OnnxModelProbeResult } from './modelProbe';
import type { OnnxRuntimeSmokeEvidence } from './runtimeSmoke';
import {
  DOCUMENTED_SSD_MOBILENET_V2_COCO_2018_CONTRACT,
  assessSsdTfProbeCompatibility,
  type SsdTfObjectDetectionContract,
} from './ssdTfObjectDetection';

export interface SsdTfTechnicalEvidenceAssessment {
  compatible: boolean;
  confirmed: boolean;
  errors: string[];
  warnings: string[];
}

function exactShape(actual: readonly number[], expected: readonly number[]): boolean {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function metadataInputShape(
  probe: OnnxModelProbeResult,
  contract: SsdTfObjectDetectionContract,
): readonly (string | number)[] | undefined {
  return probe.inputs.find((value) => value.name === contract.inputName)?.shape;
}

function isSymbolicShape(shape: readonly (string | number)[] | undefined): boolean {
  return shape !== undefined && shape.some((value) => typeof value === 'string');
}

function numericType(value: string): boolean {
  return [
    'float32', 'float64', 'int8', 'uint8', 'int16', 'uint16',
    'int32', 'uint32', 'int64', 'uint64',
  ].includes(value.trim().toLowerCase());
}

function assessRuntimeSmoke(
  smoke: OnnxRuntimeSmokeEvidence,
  contract: SsdTfObjectDetectionContract,
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!smoke.passed) {
    errors.push('runtime_smoke_failed');
    errors.push(...smoke.findings.map((finding) => `runtime_smoke:${finding}`));
    return { errors, warnings };
  }
  if (smoke.input.name !== contract.inputName) errors.push(`runtime_input_name_mismatch:${smoke.input.name}`);
  if (smoke.input.type.trim().toLowerCase() !== 'uint8') {
    errors.push(`runtime_input_type_expected_uint8:${smoke.input.type}`);
  }
  if (!exactShape(smoke.input.shape, [1, contract.inputHeight, contract.inputWidth, 3])) {
    errors.push(`runtime_input_shape_mismatch:${smoke.input.shape.join('x')}`);
  }

  const output = (name: string) => smoke.outputs.find((value) => value.name === name);
  const boxes = output(contract.outputNames.boxes);
  const scores = output(contract.outputNames.scores);
  const classes = output(contract.outputNames.classes);
  const numDetections = output(contract.outputNames.numDetections);
  for (const [role, value] of [
    ['boxes', boxes],
    ['scores', scores],
    ['classes', classes],
    ['numDetections', numDetections],
  ] as const) {
    if (!value) {
      errors.push(`runtime_missing_output_${role}`);
      continue;
    }
    if (!numericType(value.type)) errors.push(`runtime_output_not_numeric_${role}:${value.type}`);
  }
  if (boxes) {
    if (boxes.shape.length < 2 || boxes.shape.at(-1) !== 4 || boxes.dataLength % 4 !== 0) {
      errors.push(`runtime_boxes_shape_invalid:${boxes.shape.join('x')}`);
    }
  }
  if (scores && classes) {
    if (!exactShape(scores.shape, classes.shape) || scores.dataLength !== classes.dataLength) {
      errors.push('runtime_scores_classes_shape_mismatch');
    }
  }
  if (boxes && scores && boxes.dataLength / 4 !== scores.dataLength) {
    errors.push('runtime_boxes_scores_length_mismatch');
  }
  if (numDetections && numDetections.dataLength < 1) {
    errors.push('runtime_num_detections_empty');
  }
  warnings.push(...smoke.findings.map((finding) => `runtime_smoke:${finding}`));
  return { errors, warnings };
}

/**
 * Combines static ONNX metadata with optional executed runtime evidence.
 * Numeric contradictions remain hard failures. Symbolic dimensions are treated
 * as unconfirmed until an inference with the documented tensor contract passes.
 */
export function assessSsdTfTechnicalEvidence(
  probe: OnnxModelProbeResult,
  runtimeSmoke?: OnnxRuntimeSmokeEvidence,
  contract: SsdTfObjectDetectionContract = DOCUMENTED_SSD_MOBILENET_V2_COCO_2018_CONTRACT,
): SsdTfTechnicalEvidenceAssessment {
  const metadata = assessSsdTfProbeCompatibility(probe, contract);
  if (metadata.compatible) {
    return {
      compatible: true,
      confirmed: true,
      errors: [],
      warnings: [...metadata.warnings],
    };
  }

  const inputShape = metadataInputShape(probe, contract);
  const symbolicInput = isSymbolicShape(inputShape);
  const shapeErrors = metadata.errors.filter((error) => error.startsWith('input_shape_mismatch:'));
  const nonShapeErrors = metadata.errors.filter((error) => !error.startsWith('input_shape_mismatch:'));
  if (!symbolicInput || shapeErrors.length !== 1 || nonShapeErrors.length > 0) {
    return {
      compatible: false,
      confirmed: false,
      errors: [...metadata.errors],
      warnings: [...metadata.warnings],
    };
  }

  if (!runtimeSmoke) {
    return {
      compatible: true,
      confirmed: false,
      errors: [],
      warnings: [...metadata.warnings, 'input_shape_symbolic_runtime_smoke_required'],
    };
  }

  const runtime = assessRuntimeSmoke(runtimeSmoke, contract);
  return {
    compatible: runtime.errors.length === 0,
    confirmed: runtime.errors.length === 0,
    errors: [...runtime.errors],
    warnings: [
      ...metadata.warnings,
      'input_shape_symbolic_validated_by_runtime_smoke',
      ...runtime.warnings,
    ],
  };
}
