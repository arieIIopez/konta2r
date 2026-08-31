import { describe, expect, it } from 'vitest';
import {
  assertBundledModelEligible,
  evaluateModelEligibility,
  type RegisteredDetectorModel,
} from '../../src/detection/modelRegistry';

function model(overrides: Partial<RegisteredDetectorModel> = {}): RegisteredDetectorModel {
  return {
    adapterId: 'test-adapter',
    modelId: 'test-model',
    modelVersion: '1.0.0',
    modelSha256: 'a'.repeat(64),
    codeLicense: 'Apache-2.0',
    weightsLicense: 'Apache-2.0',
    weightsRedistributionVerified: true,
    inputWidth: 640,
    inputHeight: 640,
    classNames: ['person', 'bicycle', 'car'],
    registeredAtIso: '2026-08-30T00:00:00.000Z',
    ...overrides,
  };
}

describe('detector model registry', () => {
  it('allows a reproducible model with verified weight redistribution metadata', () => {
    const eligibility = evaluateModelEligibility(model());
    expect(eligibility.eligibleForExperiment).toBe(true);
    expect(eligibility.eligibleForBundledProduction).toBe(true);
    expect(() => assertBundledModelEligible(model())).not.toThrow();
  });

  it('allows experimentation but blocks bundling when checkpoint licensing is unresolved', () => {
    const candidate = model({
      weightsLicense: undefined,
      weightsRedistributionVerified: false,
    });
    const eligibility = evaluateModelEligibility(candidate);

    expect(eligibility.eligibleForExperiment).toBe(true);
    expect(eligibility.eligibleForBundledProduction).toBe(false);
    expect(eligibility.reasons).toContain('weights_license_missing');
    expect(eligibility.reasons).toContain('weights_redistribution_not_verified');
  });

  it('requires a sha256 before a model can become a reproducible bundled dependency', () => {
    const eligibility = evaluateModelEligibility(model({ modelSha256: 'not-a-sha' }));
    expect(eligibility.eligibleForBundledProduction).toBe(false);
    expect(eligibility.reasons).toContain('model_identity_or_sha256_missing');
  });

  it('rejects a candidate with no class map even for benchmark execution', () => {
    const eligibility = evaluateModelEligibility(model({ classNames: [] }));
    expect(eligibility.eligibleForExperiment).toBe(false);
    expect(eligibility.reasons).toContain('class_map_missing');
  });
});
