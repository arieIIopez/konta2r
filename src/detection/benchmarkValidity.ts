import type { DetectorBenchmarkReport } from './benchmarkReport';

export type BenchmarkValidityStatus = 'valid' | 'provisional' | 'invalid';
export type BenchmarkValiditySeverity = 'warning' | 'error';

export interface BenchmarkValidityFinding {
  code:
    | 'model_hash_missing'
    | 'annotation_hash_missing'
    | 'media_hash_missing'
    | 'empty_benchmark'
    | 'presented_frame_coverage_incomplete'
    | 'seek_error_exceeds_limit';
  severity: BenchmarkValiditySeverity;
  message: string;
}

export interface BenchmarkValidityAssessment {
  schemaVersion: '1';
  status: BenchmarkValidityStatus;
  profile: BenchmarkValidityProfile;
  findings: BenchmarkValidityFinding[];
  timedFrameCount: number;
  presentedFrameEvidenceCount: number;
  presentedFrameCoverage: number | null;
  maxObservedSeekErrorMs: number | null;
}

export type BenchmarkValidityProfile = 'development' | 'selection';

export interface BenchmarkValidityPolicy {
  profile?: BenchmarkValidityProfile;
  maxSeekErrorMs?: number;
  requireModelSha256?: boolean;
  requireAnnotationSha256?: boolean;
  requireMediaSha256WhenTimed?: boolean;
  requirePresentedFrameEvidenceWhenTimed?: boolean;
}

interface ResolvedPolicy {
  profile: BenchmarkValidityProfile;
  maxSeekErrorMs: number;
  requireModelSha256: boolean;
  requireAnnotationSha256: boolean;
  requireMediaSha256WhenTimed: boolean;
  requirePresentedFrameEvidenceWhenTimed: boolean;
}

const PROFILE_DEFAULTS: Record<BenchmarkValidityProfile, ResolvedPolicy> = {
  development: {
    profile: 'development',
    maxSeekErrorMs: 100,
    requireModelSha256: false,
    requireAnnotationSha256: false,
    requireMediaSha256WhenTimed: false,
    requirePresentedFrameEvidenceWhenTimed: false,
  },
  selection: {
    profile: 'selection',
    maxSeekErrorMs: 50,
    requireModelSha256: true,
    requireAnnotationSha256: true,
    requireMediaSha256WhenTimed: true,
    requirePresentedFrameEvidenceWhenTimed: true,
  },
};

function resolvePolicy(policy: BenchmarkValidityPolicy): ResolvedPolicy {
  const profile = policy.profile ?? 'selection';
  const defaults = PROFILE_DEFAULTS[profile];
  const maxSeekErrorMs = policy.maxSeekErrorMs ?? defaults.maxSeekErrorMs;
  if (!Number.isFinite(maxSeekErrorMs) || maxSeekErrorMs < 0) {
    throw new Error('maxSeekErrorMs must be finite and non-negative');
  }
  return {
    profile,
    maxSeekErrorMs,
    requireModelSha256: policy.requireModelSha256 ?? defaults.requireModelSha256,
    requireAnnotationSha256: policy.requireAnnotationSha256 ?? defaults.requireAnnotationSha256,
    requireMediaSha256WhenTimed: policy.requireMediaSha256WhenTimed ?? defaults.requireMediaSha256WhenTimed,
    requirePresentedFrameEvidenceWhenTimed:
      policy.requirePresentedFrameEvidenceWhenTimed ?? defaults.requirePresentedFrameEvidenceWhenTimed,
  };
}

function hasSha256(value: string | undefined): boolean {
  return value !== undefined && /^[a-f0-9]{64}$/i.test(value);
}

function addRequirementFinding(
  findings: BenchmarkValidityFinding[],
  required: boolean,
  code: BenchmarkValidityFinding['code'],
  message: string,
): void {
  findings.push({ code, severity: required ? 'error' : 'warning', message });
}

/**
 * Classifies whether a benchmark report is usable as scientific evidence.
 * Detector accuracy, model-license eligibility and scientific run validity are
 * deliberately separate concerns.
 */
export function assessDetectorBenchmarkValidity(
  report: DetectorBenchmarkReport,
  policy: BenchmarkValidityPolicy = {},
): BenchmarkValidityAssessment {
  const resolved = resolvePolicy(policy);
  const findings: BenchmarkValidityFinding[] = [];

  if (report.benchmark.frameCount === 0) {
    findings.push({
      code: 'empty_benchmark',
      severity: 'error',
      message: 'The benchmark contains zero evaluated frames.',
    });
  }

  if (!hasSha256(report.benchmark.detector.model.modelSha256)) {
    addRequirementFinding(
      findings,
      resolved.requireModelSha256,
      'model_hash_missing',
      'The detector checkpoint is not identified by a valid SHA-256 digest.',
    );
  }

  if (!hasSha256(report.corpus.annotationSha256)) {
    addRequirementFinding(
      findings,
      resolved.requireAnnotationSha256,
      'annotation_hash_missing',
      'The frozen annotation corpus is not identified by a valid SHA-256 digest.',
    );
  }

  const timedFrames = report.benchmark.frames.filter((frame) => frame.mediaTimeMs !== undefined);
  const evidencedFrames = timedFrames.filter((frame) => frame.actualMediaTimeMs !== undefined);
  const timedFrameCount = timedFrames.length;
  const presentedFrameEvidenceCount = evidencedFrames.length;
  const presentedFrameCoverage = timedFrameCount === 0
    ? null
    : presentedFrameEvidenceCount / timedFrameCount;

  if (timedFrameCount > 0 && !hasSha256(report.corpus.mediaSha256)) {
    addRequirementFinding(
      findings,
      resolved.requireMediaSha256WhenTimed,
      'media_hash_missing',
      'A timed video benchmark does not identify its source medium by SHA-256.',
    );
  }

  if (timedFrameCount > 0 && presentedFrameEvidenceCount < timedFrameCount) {
    addRequirementFinding(
      findings,
      resolved.requirePresentedFrameEvidenceWhenTimed,
      'presented_frame_coverage_incomplete',
      `Presented-frame timing evidence exists for ${presentedFrameEvidenceCount}/${timedFrameCount} timed frames.`,
    );
  }

  const absoluteErrors = evidencedFrames
    .map((frame) => {
      const expected = frame.mediaTimeMs;
      const actual = frame.actualMediaTimeMs;
      return expected === undefined || actual === undefined
        ? Number.NaN
        : Math.abs(actual - expected);
    })
    .filter(Number.isFinite);
  const maxObservedSeekErrorMs = absoluteErrors.length === 0 ? null : Math.max(...absoluteErrors);
  if (maxObservedSeekErrorMs !== null && maxObservedSeekErrorMs > resolved.maxSeekErrorMs) {
    findings.push({
      code: 'seek_error_exceeds_limit',
      severity: 'error',
      message: `Maximum presented-frame seek error ${maxObservedSeekErrorMs.toFixed(2)} ms exceeds the configured ${resolved.maxSeekErrorMs.toFixed(2)} ms limit.`,
    });
  }

  const hasError = findings.some((finding) => finding.severity === 'error');
  const status: BenchmarkValidityStatus = hasError
    ? 'invalid'
    : findings.length > 0
      ? 'provisional'
      : 'valid';

  return {
    schemaVersion: '1',
    status,
    profile: resolved.profile,
    findings,
    timedFrameCount,
    presentedFrameEvidenceCount,
    presentedFrameCoverage,
    maxObservedSeekErrorMs,
  };
}
