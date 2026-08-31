import type { OnnxModelProbeResult } from './modelProbe';
import {
  assessNanoDetPlusProbeCompatibility,
  type NanoDetPlusContract,
} from './nanodetPlus';
import type { OnnxRuntimeSmokeEvidence } from './runtimeSmoke';

export interface NanoDetTechnicalEvidenceAssessment {
  compatible: boolean;
  confirmed: boolean;
  errors: string[];
  warnings: string[];
}

function sameShape(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function expectedOutputShape(
  contract: NanoDetPlusContract,
  outputName: string,
): number[] | undefined {
  for (const level of contract.levels) {
    if (level.classOutputName === outputName) return [1, level.locations, contract.classCount];
    if (level.bboxOutputName === outputName) return [1, level.locations, 4 * (contract.regMax + 1)];
  }
  return undefined;
}

/**
 * NanoDet is considered technically confirmed only when two independent pieces
 * of evidence agree: static ONNX metadata must match the codec contract and an
 * executed ONNX Runtime Web/WASM smoke must reproduce that same contract.
 */
export function assessNanoDetTechnicalEvidence(
  probe: OnnxModelProbeResult,
  runtimeSmoke?: OnnxRuntimeSmokeEvidence,
): NanoDetTechnicalEvidenceAssessment {
  const staticAssessment = assessNanoDetPlusProbeCompatibility(probe);
  const errors = [...staticAssessment.errors];
  const warnings = [...staticAssessment.warnings];
  const contract = staticAssessment.contract;

  if (!staticAssessment.compatible || !contract) {
    return { compatible: false, confirmed: false, errors, warnings };
  }

  if (!runtimeSmoke) {
    warnings.push('nanodet_runtime_smoke_required');
    return { compatible: true, confirmed: false, errors, warnings };
  }
  if (!runtimeSmoke.passed) {
    errors.push('nanodet_runtime_smoke_failed');
    errors.push(...runtimeSmoke.findings.map((finding) => `runtime_smoke:${finding}`));
    return { compatible: false, confirmed: false, errors, warnings };
  }

  const expectedInputShape = [1, 3, contract.inputHeight, contract.inputWidth];
  if (
    runtimeSmoke.input.name !== contract.inputName
    || runtimeSmoke.input.type !== 'float32'
    || !sameShape(runtimeSmoke.input.shape, expectedInputShape)
  ) {
    errors.push(
      `nanodet_runtime_input_mismatch:${runtimeSmoke.input.name}:${runtimeSmoke.input.type}:${runtimeSmoke.input.shape.join('x')}`,
    );
  }

  const expectedNames = new Set(
    contract.levels.flatMap((level) => [level.classOutputName, level.bboxOutputName]),
  );
  if (runtimeSmoke.outputs.length !== expectedNames.size) {
    errors.push(`nanodet_runtime_output_count_mismatch:${runtimeSmoke.outputs.length}`);
  }

  for (const output of runtimeSmoke.outputs) {
    const expectedShape = expectedOutputShape(contract, output.name);
    if (!expectedShape) {
      errors.push(`nanodet_runtime_unexpected_output:${output.name}`);
      continue;
    }
    if (output.type !== 'float32' || !sameShape(output.shape, expectedShape)) {
      errors.push(`nanodet_runtime_output_mismatch:${output.name}:${output.type}:${output.shape.join('x')}`);
      continue;
    }
    const expectedLength = expectedShape.reduce((product, dimension) => product * dimension, 1);
    if (output.dataLength !== expectedLength) {
      errors.push(`nanodet_runtime_output_length_mismatch:${output.name}:${output.dataLength}:${expectedLength}`);
    }
    expectedNames.delete(output.name);
  }
  for (const missingName of expectedNames) errors.push(`nanodet_runtime_missing_output:${missingName}`);

  return {
    compatible: errors.length === 0,
    confirmed: errors.length === 0,
    errors,
    warnings,
  };
}
