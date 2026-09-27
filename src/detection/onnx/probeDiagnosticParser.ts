import type { DetectorBackend } from '../types';
import type { CandidateProbeCompatibilityStatus } from './candidateProbeCompatibility';
import type { OnnxCandidateProbeDiagnosticRecord } from './probeDiagnostic';
import type { ProbeMetadataCompleteness } from './probeRecord';
import type { OnnxValueKind, OnnxValueMetadata } from './runtime';
import type { OnnxRuntimeSmokeEvidence } from './runtimeSmoke';
import { validateOnnxRuntimeSmokeEvidence } from './runtimeSmoke';

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be boolean`);
  return value;
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be a finite number`);
  return value;
}

function integerNumber(value: unknown, label: string): number {
  const number = finiteNumber(value, label);
  if (!Number.isInteger(number)) throw new Error(`${label} must be an integer`);
  return number;
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  return stringValue(value, label);
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${label} must be an array of strings`);
  }
  return [...value] as string[];
}

function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new Error(`${label} is not a supported value`);
  }
  return value as T;
}

const VALUE_KINDS: readonly OnnxValueKind[] = ['tensor', 'non_tensor', 'unknown'];
const BACKENDS: readonly DetectorBackend[] = ['webgpu', 'wasm', 'webnn', 'webgl', 'unknown'];
const COMPLETENESS: readonly ProbeMetadataCompleteness[] = ['complete', 'partial', 'names_only', 'empty'];
const COMPATIBILITY: readonly CandidateProbeCompatibilityStatus[] = [
  'compatible', 'unconfirmed', 'incompatible', 'not_assessed',
];

function parseShape(value: unknown, label: string): Array<string | number> | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' && typeof item !== 'number')) {
    throw new Error(`${label} must be an array of strings/numbers`);
  }
  return value.map((item, index) => typeof item === 'number'
    ? finiteNumber(item, `${label}[${index}]`)
    : item) as Array<string | number>;
}

function parseNumericShape(value: unknown, label: string): number[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((item, index) => integerNumber(item, `${label}[${index}]`));
}

function parseMetadataArray(value: unknown, label: string): OnnxValueMetadata[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((item, index) => {
    const record = objectValue(item, `${label}[${index}]`);
    const metadata: OnnxValueMetadata = {
      name: stringValue(record.name, `${label}[${index}].name`),
      kind: enumValue(record.kind, VALUE_KINDS, `${label}[${index}].kind`),
    };
    const type = optionalString(record.type, `${label}[${index}].type`);
    const shape = parseShape(record.shape, `${label}[${index}].shape`);
    if (type !== undefined) metadata.type = type;
    if (shape !== undefined) metadata.shape = shape;
    return metadata;
  });
}

function parseRuntimeSmoke(value: unknown): OnnxRuntimeSmokeEvidence {
  const record = objectValue(value, 'probe.runtimeSmoke');
  if (record.schemaVersion !== '1') throw new Error('probe.runtimeSmoke.schemaVersion must be 1');
  if (record.attempted !== true) throw new Error('probe.runtimeSmoke.attempted must be true');
  const input = objectValue(record.input, 'probe.runtimeSmoke.input');
  if (!Array.isArray(record.outputs)) throw new Error('probe.runtimeSmoke.outputs must be an array');
  const evidence: OnnxRuntimeSmokeEvidence = {
    schemaVersion: '1',
    attempted: true,
    passed: booleanValue(record.passed, 'probe.runtimeSmoke.passed'),
    input: {
      name: stringValue(input.name, 'probe.runtimeSmoke.input.name'),
      type: stringValue(input.type, 'probe.runtimeSmoke.input.type'),
      shape: parseNumericShape(input.shape, 'probe.runtimeSmoke.input.shape'),
    },
    outputs: record.outputs.map((value, index) => {
      const output = objectValue(value, `probe.runtimeSmoke.outputs[${index}]`);
      return {
        name: stringValue(output.name, `probe.runtimeSmoke.outputs[${index}].name`),
        type: stringValue(output.type, `probe.runtimeSmoke.outputs[${index}].type`),
        shape: parseNumericShape(output.shape, `probe.runtimeSmoke.outputs[${index}].shape`),
        dataLength: integerNumber(output.dataLength, `probe.runtimeSmoke.outputs[${index}].dataLength`),
      };
    }),
    findings: stringArray(record.findings, 'probe.runtimeSmoke.findings'),
  };
  validateOnnxRuntimeSmokeEvidence(evidence);
  return evidence;
}

function parseProbe(value: unknown): OnnxCandidateProbeDiagnosticRecord['probe'] {
  const record = objectValue(value, 'probe');
  if (record.schemaVersion !== '1.0') throw new Error('probe.schemaVersion must be 1.0');
  if (record.recordType !== 'onnx_model_probe') throw new Error('probe.recordType must be onnx_model_probe');
  const artifact = objectValue(record.artifact, 'probe.artifact');
  const runtime = objectValue(record.runtime, 'probe.runtime');
  const hint = objectValue(record.inputHintAssessment, 'probe.inputHintAssessment');

  const backend = enumValue(runtime.backend, BACKENDS, 'probe.runtime.backend');
  const providersRaw = stringArray(runtime.executionProviders, 'probe.runtime.executionProviders');
  const executionProviders = providersRaw.map((provider, index) =>
    enumValue(provider, BACKENDS, `probe.runtime.executionProviders[${index}]`));

  const probe: OnnxCandidateProbeDiagnosticRecord['probe'] = {
    schemaVersion: '1.0',
    recordType: 'onnx_model_probe',
    candidateId: stringValue(record.candidateId, 'probe.candidateId'),
    candidateDisplayName: stringValue(record.candidateDisplayName, 'probe.candidateDisplayName'),
    artifact: {
      sourceUrl: stringValue(artifact.sourceUrl, 'probe.artifact.sourceUrl'),
      sha256: stringValue(artifact.sha256, 'probe.artifact.sha256'),
      sizeBytes: finiteNumber(artifact.sizeBytes, 'probe.artifact.sizeBytes'),
      declaredLicense: stringValue(artifact.declaredLicense, 'probe.artifact.declaredLicense'),
      redistributionVerified: booleanValue(artifact.redistributionVerified, 'probe.artifact.redistributionVerified'),
    },
    probedAtIso: stringValue(record.probedAtIso, 'probe.probedAtIso'),
    runtime: {
      runtime: enumValue(runtime.runtime, ['onnxruntime-web', 'other'] as const, 'probe.runtime.runtime'),
      backend,
      executionProviders,
    },
    webgpuAttempted: booleanValue(record.webgpuAttempted, 'probe.webgpuAttempted'),
    inputs: parseMetadataArray(record.inputs, 'probe.inputs'),
    outputs: parseMetadataArray(record.outputs, 'probe.outputs'),
    metadataCompleteness: enumValue(record.metadataCompleteness, COMPLETENESS, 'probe.metadataCompleteness'),
    inputHintAssessment: {},
  };

  const runtimeVersion = optionalString(runtime.runtimeVersion, 'probe.runtime.runtimeVersion');
  const fallbackReason = optionalString(record.fallbackReason, 'probe.fallbackReason');
  if (runtimeVersion !== undefined) probe.runtime.runtimeVersion = runtimeVersion;
  if (fallbackReason !== undefined) probe.fallbackReason = fallbackReason;
  if (record.runtimeSmoke !== undefined) probe.runtimeSmoke = parseRuntimeSmoke(record.runtimeSmoke);

  const expectedWidth = hint.expectedWidth === undefined ? undefined : finiteNumber(hint.expectedWidth, 'probe.inputHintAssessment.expectedWidth');
  const expectedHeight = hint.expectedHeight === undefined ? undefined : finiteNumber(hint.expectedHeight, 'probe.inputHintAssessment.expectedHeight');
  const expectedLayout = optionalString(hint.expectedLayout, 'probe.inputHintAssessment.expectedLayout');
  const observedShape = parseShape(hint.observedShape, 'probe.inputHintAssessment.observedShape');
  const dimensionsMatch = hint.dimensionsMatch === undefined
    ? undefined
    : booleanValue(hint.dimensionsMatch, 'probe.inputHintAssessment.dimensionsMatch');
  if (expectedWidth !== undefined) probe.inputHintAssessment.expectedWidth = expectedWidth;
  if (expectedHeight !== undefined) probe.inputHintAssessment.expectedHeight = expectedHeight;
  if (expectedLayout !== undefined) probe.inputHintAssessment.expectedLayout = expectedLayout;
  if (observedShape !== undefined) probe.inputHintAssessment.observedShape = observedShape;
  if (dimensionsMatch !== undefined) probe.inputHintAssessment.dimensionsMatch = dimensionsMatch;

  if (Number.isNaN(Date.parse(probe.probedAtIso))) throw new Error('probe.probedAtIso must be a valid date');
  if (!/^[a-f0-9]{64}$/i.test(probe.artifact.sha256)) throw new Error('probe.artifact.sha256 must be a SHA-256 hex digest');
  if (probe.artifact.sizeBytes < 0) throw new Error('probe.artifact.sizeBytes must be non-negative');
  return probe;
}

function parseCompatibility(value: unknown): OnnxCandidateProbeDiagnosticRecord['codecCompatibility'] {
  const record = objectValue(value, 'codecCompatibility');
  if (record.schemaVersion !== '1') throw new Error('codecCompatibility.schemaVersion must be 1');
  const codecId = record.codecId === null
    ? null
    : stringValue(record.codecId, 'codecCompatibility.codecId');
  return {
    schemaVersion: '1',
    candidateId: stringValue(record.candidateId, 'codecCompatibility.candidateId'),
    codecId,
    status: enumValue(record.status, COMPATIBILITY, 'codecCompatibility.status'),
    errors: stringArray(record.errors, 'codecCompatibility.errors'),
    warnings: stringArray(record.warnings, 'codecCompatibility.warnings'),
  };
}

/** Parse a local diagnostic as untrusted JSON. No candidate lookup or technical
 * verification occurs here; those are separate gates after structural parsing.
 */
export function parseOnnxCandidateProbeDiagnosticJson(
  text: string,
): OnnxCandidateProbeDiagnosticRecord {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new Error('Diagnostic file is not valid JSON');
  }
  const record = objectValue(value, 'diagnostic');
  if (record.schemaVersion !== '1') throw new Error('diagnostic.schemaVersion must be 1');
  if (record.recordType !== 'onnx_candidate_probe_diagnostic') {
    throw new Error('diagnostic.recordType must be onnx_candidate_probe_diagnostic');
  }
  return {
    schemaVersion: '1',
    recordType: 'onnx_candidate_probe_diagnostic',
    probe: parseProbe(record.probe),
    codecCompatibility: parseCompatibility(record.codecCompatibility),
  };
}
