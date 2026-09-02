import type { DetectorModelMetadata } from './types';

export interface RegisteredDetectorModel extends DetectorModelMetadata {
  fileSizeBytes?: number;
  registeredAtIso: string;
  notes?: string[];
}

export interface ModelEligibility {
  eligibleForExperiment: boolean;
  eligibleForBundledProduction: boolean;
  reasons: string[];
}

function looksLikeSha256(value: string | undefined): boolean {
  return value !== undefined && /^[a-f0-9]{64}$/i.test(value);
}

/**
 * Technical eligibility is deliberately separate from legal interpretation.
 * The registry requires explicit metadata/evidence before a checkpoint can be
 * bundled, but this function does not itself make a legal determination.
 */
export function evaluateModelEligibility(model: RegisteredDetectorModel): ModelEligibility {
  const reasons: string[] = [];

  const identityComplete = model.modelId.trim().length > 0
    && model.modelVersion.trim().length > 0
    && looksLikeSha256(model.modelSha256);
  if (!identityComplete) reasons.push('model_identity_or_sha256_missing');

  if (!model.codeLicense?.trim()) reasons.push('code_license_missing');
  if (!model.weightsLicense?.trim()) reasons.push('weights_license_missing');
  if (!model.weightsRedistributionVerified) reasons.push('weights_redistribution_not_verified');
  if (model.inputWidth <= 0 || model.inputHeight <= 0) reasons.push('invalid_model_input_shape');
  if (model.classNames.length === 0) reasons.push('class_map_missing');

  const eligibleForExperiment = model.inputWidth > 0
    && model.inputHeight > 0
    && model.classNames.length > 0;

  const eligibleForBundledProduction = eligibleForExperiment
    && identityComplete
    && Boolean(model.codeLicense?.trim())
    && Boolean(model.weightsLicense?.trim())
    && model.weightsRedistributionVerified;

  return {
    eligibleForExperiment,
    eligibleForBundledProduction,
    reasons,
  };
}

export function assertBundledModelEligible(model: RegisteredDetectorModel): void {
  const eligibility = evaluateModelEligibility(model);
  if (!eligibility.eligibleForBundledProduction) {
    throw new Error(`Detector model is not eligible for bundled production: ${eligibility.reasons.join(', ')}`);
  }
}
