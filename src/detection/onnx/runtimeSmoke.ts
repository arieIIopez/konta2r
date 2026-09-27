export interface OnnxRuntimeSmokeTensorObservation {
  name: string;
  type: string;
  shape: number[];
  dataLength: number;
}

export interface OnnxRuntimeSmokeEvidence {
  schemaVersion: '1';
  attempted: true;
  passed: boolean;
  input: {
    name: string;
    type: string;
    shape: number[];
  };
  outputs: OnnxRuntimeSmokeTensorObservation[];
  findings: string[];
}

function validShape(shape: readonly number[]): boolean {
  return shape.length > 0
    && shape.every((value) => Number.isInteger(value) && value >= 0);
}

export function validateOnnxRuntimeSmokeEvidence(evidence: OnnxRuntimeSmokeEvidence): void {
  if (evidence.schemaVersion !== '1' || evidence.attempted !== true) {
    throw new Error('Runtime smoke evidence must use schemaVersion 1 and attempted=true');
  }
  if (evidence.input.name.trim().length === 0 || evidence.input.type.trim().length === 0) {
    throw new Error('Runtime smoke input name and type are required');
  }
  if (!validShape(evidence.input.shape)) throw new Error('Runtime smoke input shape is invalid');
  const names = new Set<string>();
  for (const output of evidence.outputs) {
    if (output.name.trim().length === 0 || output.type.trim().length === 0) {
      throw new Error('Runtime smoke output name and type are required');
    }
    if (names.has(output.name)) throw new Error(`Runtime smoke output ${output.name} is duplicated`);
    names.add(output.name);
    if (!validShape(output.shape)) throw new Error(`Runtime smoke output ${output.name} shape is invalid`);
    if (!Number.isInteger(output.dataLength) || output.dataLength < 0) {
      throw new Error(`Runtime smoke output ${output.name} dataLength is invalid`);
    }
  }
  if (evidence.findings.some((value) => value.trim().length === 0)) {
    throw new Error('Runtime smoke findings cannot contain empty values');
  }
}

export function cloneOnnxRuntimeSmokeEvidence(
  evidence: OnnxRuntimeSmokeEvidence,
): OnnxRuntimeSmokeEvidence {
  validateOnnxRuntimeSmokeEvidence(evidence);
  return {
    schemaVersion: '1',
    attempted: true,
    passed: evidence.passed,
    input: {
      ...evidence.input,
      shape: [...evidence.input.shape],
    },
    outputs: evidence.outputs.map((output) => ({
      ...output,
      shape: [...output.shape],
    })),
    findings: [...evidence.findings],
  };
}

export function runtimeSmokeOutputByName(
  evidence: OnnxRuntimeSmokeEvidence | undefined,
  name: string,
): OnnxRuntimeSmokeTensorObservation | undefined {
  return evidence?.outputs.find((value) => value.name === name);
}
