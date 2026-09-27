export interface TemporalSamplingOptions {
  durationMs: number;
  sampleCount: number;
  seed: string;
  startMarginMs?: number;
  endMarginMs?: number;
  /** Fraction of each temporal stratum available for random displacement around its center. 0 = centers only, 1 = full stratum. */
  jitterFraction?: number;
}

export interface TemporalSamplingPlan {
  schemaVersion: '1';
  strategy: 'stratified_uniform_jitter';
  durationMs: number;
  sampleCount: number;
  seed: string;
  startMarginMs: number;
  endMarginMs: number;
  jitterFraction: number;
  plannedMediaTimesMs: number[];
}

function finiteNonNegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be finite and non-negative`);
  return value;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} must be a positive integer`);
  return value;
}

function hashSeed(seed: string): number {
  const normalized = seed.trim();
  if (normalized.length === 0) throw new Error('seed is required');
  let hash = 0x811c9dc5;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Creates a deterministic stratified sample over video time. Each requested
 * frame occupies its own temporal stratum, so a sequence cannot be dominated
 * by a short burst merely because the pseudo-random generator clustered draws.
 *
 * The seed is part of the plan and therefore makes the proposed media times
 * exactly reproducible. Manual/adversarial frames should be recorded separately
 * rather than silently replacing planned sample points.
 */
export function createTemporalSamplingPlan(options: TemporalSamplingOptions): TemporalSamplingPlan {
  const durationMs = finiteNonNegative(options.durationMs, 'durationMs');
  if (!(durationMs > 0)) throw new Error('durationMs must be greater than zero');
  const sampleCount = positiveInteger(options.sampleCount, 'sampleCount');
  const startMarginMs = finiteNonNegative(options.startMarginMs ?? 0, 'startMarginMs');
  const endMarginMs = finiteNonNegative(options.endMarginMs ?? 0, 'endMarginMs');
  const jitterFraction = options.jitterFraction ?? 0.5;
  if (!Number.isFinite(jitterFraction) || jitterFraction < 0 || jitterFraction > 1) {
    throw new Error('jitterFraction must be between 0 and 1');
  }
  if (startMarginMs + endMarginMs >= durationMs) {
    throw new Error('sampling margins leave no usable video interval');
  }

  const usableStart = startMarginMs;
  const usableEnd = durationMs - endMarginMs;
  const usableDuration = usableEnd - usableStart;
  const stratumWidth = usableDuration / sampleCount;
  if (!(stratumWidth > 0)) throw new Error('temporal strata must have positive width');

  const random = mulberry32(hashSeed(options.seed));
  const plannedMediaTimesMs: number[] = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const stratumStart = usableStart + index * stratumWidth;
    const stratumEnd = stratumStart + stratumWidth;
    const center = (stratumStart + stratumEnd) / 2;
    const maximumOffset = (stratumWidth / 2) * jitterFraction;
    const offset = (random() * 2 - 1) * maximumOffset;
    const candidate = Math.min(stratumEnd, Math.max(stratumStart, center + offset));
    plannedMediaTimesMs.push(candidate);
  }

  return {
    schemaVersion: '1',
    strategy: 'stratified_uniform_jitter',
    durationMs,
    sampleCount,
    seed: options.seed.trim(),
    startMarginMs,
    endMarginMs,
    jitterFraction,
    plannedMediaTimesMs,
  };
}

export function validateTemporalSamplingPlan(plan: TemporalSamplingPlan): void {
  if (plan.schemaVersion !== '1') throw new Error('Unsupported temporal sampling schemaVersion');
  if (plan.strategy !== 'stratified_uniform_jitter') throw new Error('Unsupported temporal sampling strategy');
  const regenerated = createTemporalSamplingPlan({
    durationMs: plan.durationMs,
    sampleCount: plan.sampleCount,
    seed: plan.seed,
    startMarginMs: plan.startMarginMs,
    endMarginMs: plan.endMarginMs,
    jitterFraction: plan.jitterFraction,
  });
  if (plan.plannedMediaTimesMs.length !== regenerated.plannedMediaTimesMs.length) {
    throw new Error('Temporal sampling plan length does not match its declared configuration');
  }
  for (let index = 0; index < plan.plannedMediaTimesMs.length; index += 1) {
    const observed = plan.plannedMediaTimesMs[index];
    const expected = regenerated.plannedMediaTimesMs[index];
    if (observed === undefined || expected === undefined || !Number.isFinite(observed) || Math.abs(observed - expected) > 1e-9) {
      throw new Error(`Temporal sampling plan is not reproducible at index ${index}`);
    }
  }
}
