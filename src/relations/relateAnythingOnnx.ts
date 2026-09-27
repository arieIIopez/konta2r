import * as ort from 'onnxruntime-web/webgpu';
import {
  createOnnxSessionWithFallback,
  disposeOnnxValues,
  type OnnxModelSource,
  type OnnxRuntimeCapabilities,
  type OnnxSessionFactory,
  type OnnxSessionLike,
  type OnnxValueMap,
} from '../detection/onnx/runtime';
import type {
  RelationCandidate,
  RelationEndpoint,
  RelationObservation,
  RelationProvider,
  RelationProviderMetadata,
  RelationInput,
} from './types';

export type RelateAnythingVocabularyMode = 'input' | 'baked';
export type RelateAnythingEligibilityMode = 'experiment' | 'bundled_production';

export interface RelateAnythingReleaseContract {
  providerId: string;
  modelId: string;
  modelVersion: string;
  modelSha256?: string;
  sourceUrl?: string;
  codeLicense?: string;
  weightsLicense?: string;
  weightsRedistributionVerified: boolean;
  imgSize: number;
  maxBoxes: number;
  finalBudget: number;
  vocabMode: RelateAnythingVocabularyMode;
  textDim: number;
  predicates: string[];
  outputKind: 'logits';
  outputs: {
    predLogits: string;
    pairLogits: string;
    subjectIndex: string;
    objectIndex: string;
    validMask: string;
  };
  calibration: {
    a: number;
    b: number;
  };
  pairWeight: number;
}

export interface RelateAnythingPredicateBank {
  names: string[];
  dim: number;
  W: number[][];
  alpha: number[];
  thr?: Array<number | null>;
  default?: string[];
  checkpoint?: string;
  student?: string;
}

export interface RelateAnythingRgbResize {
  (
    source: CanvasImageSource,
    width: number,
    height: number,
  ): Promise<Uint8Array> | Uint8Array;
}

export interface RelateAnythingOnnxProviderOptions {
  contract: RelateAnythingReleaseContract;
  modelSource: OnnxModelSource;
  bank?: RelateAnythingPredicateBank;
  eligibilityMode?: RelateAnythingEligibilityMode;
  minScore?: number;
  maxPredicatesPerPair?: number;
  useBankThresholds?: boolean;
  resizeRgb?: RelateAnythingRgbResize;
  capabilities?: OnnxRuntimeCapabilities;
  sessionFactory?: OnnxSessionFactory;
  preferWebGpu?: boolean;
}

export interface RelateAnythingScoreContract {
  calibA: number;
  calibB: number;
  pairWeight: number;
}

interface SelectedVocabulary {
  names: string[];
  W?: Float32Array;
  alpha?: Float32Array;
  thresholds: Array<number | null>;
}

interface EndpointPlan {
  endpoints: RelationEndpoint[];
  allowedPairs: Set<string>;
}

interface TensorDataLike {
  readonly length: number;
  readonly [index: number]: number | bigint | boolean;
}

/**
 * Exact public release contract from Maelic/RelateAnything
 * deploy/dist/relsgg-vits16/relateanything.json (exported 2026-08-27).
 *
 * This is a technical IO contract only. It deliberately does not embed a
 * checkpoint URL or assert redistribution rights.
 */
export const RELATEANYTHING_VITS16_2026_08_27: RelateAnythingReleaseContract = {
  providerId: 'relateanything-onnx',
  modelId: 'relsgg-vits16',
  modelVersion: '2026-08-27-e9ea42a',
  sourceUrl: 'https://huggingface.co/maelic/relsgg-vits16',
  codeLicense: 'Apache-2.0',
  weightsLicense: 'DINOv3-derived checkpoint; redistribution review required',
  weightsRedistributionVerified: false,
  imgSize: 448,
  maxBoxes: 32,
  finalBudget: 128,
  vocabMode: 'input',
  textDim: 512,
  predicates: [
    'wearing', 'riding', 'playing', 'sitting on', 'sitting at', 'holding',
    'sitting in', 'looking at', 'using', 'watching', 'standing on',
    'carrying', 'talking to', 'smiling at', 'standing beside', 'walking past',
    'posing with', 'leaning against', 'part of', 'resting on', 'on',
    'covering', 'inside', 'on top of', 'contained in', 'hanging from',
    'surrounding', 'attached to', 'in front of', 'beside', 'to the left of',
    'to the right of', 'behind', 'above', 'below',
  ],
  outputKind: 'logits',
  outputs: {
    predLogits: 'pred_logits',
    pairLogits: 'pair_logits',
    subjectIndex: 'sub_idx',
    objectIndex: 'obj_idx',
    validMask: 'valid_mask',
  },
  calibration: { a: 0.5377, b: -1.9694 },
  pairWeight: 1,
};


/**
 * Runtime-verified release contract for the currently recommended ViT-S/16+
 * checkpoint. The exact ONNX artifact was executed with ONNX Runtime Web/WASM
 * on the Konta2r self-hosted runner and is pinned by SHA-256.
 *
 * Runtime verification does not imply scientific validation on Public Life
 * scenes or permission to redistribute the checkpoint.
 */
export const RELATEANYTHING_VITS16PLUS_2026_08_27: RelateAnythingReleaseContract = {
  providerId: 'relateanything-onnx',
  modelId: 'relsgg-vits16plus',
  modelVersion: '2026-08-27-e9ea42a',
  modelSha256: 'b8b6a047c5e0771a897a5015c2ffb09d8fe5e3ffa0651e1e61af0e8436a3617a',
  sourceUrl: 'https://huggingface.co/maelic/relsgg-vits16plus/resolve/main/relateanything.onnx',
  codeLicense: 'Apache-2.0',
  weightsLicense: 'DINOv3-derived checkpoint; redistribution review required',
  weightsRedistributionVerified: false,
  imgSize: 448,
  maxBoxes: 32,
  finalBudget: 128,
  vocabMode: 'input',
  textDim: 512,
  predicates: [
    'wearing', 'riding', 'playing', 'sitting on', 'sitting at', 'holding',
    'sitting in', 'looking at', 'using', 'watching', 'standing on',
    'carrying', 'talking to', 'smiling at', 'standing beside', 'walking past',
    'posing with', 'leaning against', 'part of', 'resting on', 'on',
    'covering', 'inside', 'on top of', 'contained in', 'hanging from',
    'surrounding', 'attached to', 'in front of', 'beside', 'to the left of',
    'to the right of', 'behind', 'above', 'below',
  ],
  outputKind: 'logits',
  outputs: {
    predLogits: 'pred_logits',
    pairLogits: 'pair_logits',
    subjectIndex: 'sub_idx',
    objectIndex: 'obj_idx',
    validMask: 'valid_mask',
  },
  calibration: { a: 0.5651, b: -1.9623 },
  pairWeight: 1,
};

function validProbability(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be within [0, 1]`);
  }
  return value;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be an integer >= 1`);
  }
  return value;
}

function looksLikeSha256(value: string | undefined): boolean {
  return value !== undefined && /^[a-f0-9]{64}$/i.test(value);
}

function assertContract(contract: RelateAnythingReleaseContract): void {
  if (contract.providerId.trim().length === 0) throw new Error('providerId is required');
  if (contract.modelId.trim().length === 0) throw new Error('modelId is required');
  if (contract.modelVersion.trim().length === 0) throw new Error('modelVersion is required');
  positiveInteger(contract.imgSize, 'imgSize');
  positiveInteger(contract.maxBoxes, 'maxBoxes');
  positiveInteger(contract.finalBudget, 'finalBudget');
  positiveInteger(contract.textDim, 'textDim');
  if (!(contract.calibration.a > 0) || !Number.isFinite(contract.calibration.a)) {
    throw new Error('calibration.a must be finite and > 0');
  }
  if (!Number.isFinite(contract.calibration.b)) throw new Error('calibration.b must be finite');
  if (!Number.isFinite(contract.pairWeight)) throw new Error('pairWeight must be finite');
  if (contract.outputKind !== 'logits') throw new Error('RelateAnything provider requires raw-logit output');
}

function assertEligibility(
  contract: RelateAnythingReleaseContract,
  mode: RelateAnythingEligibilityMode,
): void {
  assertContract(contract);
  if (mode === 'experiment') return;

  const reasons: string[] = [];
  if (!looksLikeSha256(contract.modelSha256)) reasons.push('model_sha256_missing');
  if (!contract.codeLicense?.trim()) reasons.push('code_license_missing');
  if (!contract.weightsLicense?.trim()) reasons.push('weights_license_missing');
  if (!contract.weightsRedistributionVerified) reasons.push('weights_redistribution_not_verified');
  if (reasons.length > 0) {
    throw new Error(`Relation model is not eligible for bundled production: ${reasons.join(', ')}`);
  }
}

function assertBank(bank: RelateAnythingPredicateBank, textDim: number): void {
  if (!Number.isInteger(bank.dim) || bank.dim !== textDim) {
    throw new Error(`Predicate bank dim ${bank.dim} does not match model textDim ${textDim}`);
  }
  if (bank.names.length === 0) throw new Error('Predicate bank must contain at least one row');
  if (bank.W.length !== bank.names.length || bank.alpha.length !== bank.names.length) {
    throw new Error('Predicate bank names, W and alpha lengths must match');
  }
  if (bank.thr && bank.thr.length !== bank.names.length) {
    throw new Error('Predicate bank threshold length must match names');
  }
  const seen = new Set<string>();
  for (let index = 0; index < bank.names.length; index += 1) {
    const name = bank.names[index]?.trim() ?? '';
    if (name.length === 0) throw new Error(`Predicate bank row ${index} has an empty name`);
    if (seen.has(name)) throw new Error(`Predicate bank contains duplicate predicate: ${name}`);
    seen.add(name);
    const row = bank.W[index];
    if (!row || row.length !== textDim || row.some((value) => !Number.isFinite(value))) {
      throw new Error(`Predicate bank row ${name} does not match textDim or contains non-finite values`);
    }
    const alpha = bank.alpha[index];
    if (alpha === undefined || !Number.isFinite(alpha)) {
      throw new Error(`Predicate bank alpha is invalid for ${name}`);
    }
  }
}

function selectVocabulary(
  requested: readonly string[],
  contract: RelateAnythingReleaseContract,
  bank: RelateAnythingPredicateBank | undefined,
): SelectedVocabulary {
  const names = [...new Set(requested.map((value) => value.trim()).filter(Boolean))];
  if (names.length === 0) throw new Error('Relation vocabulary must contain at least one predicate');

  if (contract.vocabMode === 'baked') {
    const available = new Set(contract.predicates);
    const missing = names.filter((name) => !available.has(name));
    if (missing.length > 0) {
      throw new Error(`Predicates are not baked into the relation model: ${missing.join(', ')}`);
    }
    return { names, thresholds: names.map(() => null) };
  }

  if (!bank) throw new Error('vocab-mode=input requires a predicate bank');
  assertBank(bank, contract.textDim);
  const indexByName = new Map(bank.names.map((name, index) => [name, index] as const));
  const indices = names.map((name) => {
    const index = indexByName.get(name);
    if (index === undefined) {
      throw new Error(
        `Predicate "${name}" is not present in the supplied bank; open-vocabulary text must be encoded before browser inference`,
      );
    }
    return index;
  });

  const W = new Float32Array(names.length * contract.textDim);
  const alpha = new Float32Array(names.length);
  const thresholds: Array<number | null> = [];
  indices.forEach((bankIndex, vocabularyIndex) => {
    const row = bank.W[bankIndex] as number[];
    W.set(row, vocabularyIndex * contract.textDim);
    alpha[vocabularyIndex] = bank.alpha[bankIndex] as number;
    const threshold = bank.thr?.[bankIndex];
    thresholds.push(threshold === undefined || threshold === null || !Number.isFinite(threshold)
      ? null
      : validProbability(threshold, `threshold for ${names[vocabularyIndex]}`));
  });

  return { names, W, alpha, thresholds };
}

function endpointKey(endpoint: RelationEndpoint): string {
  return `${endpoint.kind}:${endpoint.id}`;
}

function pairKey(subject: RelationEndpoint, object: RelationEndpoint): string {
  return `${endpointKey(subject)}=>${endpointKey(object)}`;
}

function buildEndpointPlan(
  candidates: readonly RelationCandidate[],
  maxBoxes: number,
): EndpointPlan {
  const endpoints: RelationEndpoint[] = [];
  const endpointIndex = new Map<string, number>();
  const allowedPairs = new Set<string>();

  const ordered = [...candidates].sort((a, b) => b.priority - a.priority);
  for (const candidate of ordered) {
    const subjectKey = endpointKey(candidate.subject);
    const objectKey = endpointKey(candidate.object);
    const needed = Number(!endpointIndex.has(subjectKey)) + Number(!endpointIndex.has(objectKey));
    if (endpoints.length + needed > maxBoxes) continue;

    for (const endpoint of [candidate.subject, candidate.object]) {
      const key = endpointKey(endpoint);
      if (endpointIndex.has(key)) continue;
      endpointIndex.set(key, endpoints.length);
      endpoints.push({ ...endpoint, bbox: { ...endpoint.bbox } });
    }
    allowedPairs.add(pairKey(candidate.subject, candidate.object));
  }

  return { endpoints, allowedPairs };
}

function clip(value: number, lower: number, upper: number): number {
  return Math.max(lower, Math.min(upper, value));
}

export function relationBoxesCxCyWh(
  endpoints: readonly RelationEndpoint[],
  sourceWidth: number,
  sourceHeight: number,
  maxBoxes: number,
): Float32Array {
  if (!(sourceWidth > 0) || !(sourceHeight > 0)) {
    throw new Error('Relation source dimensions must be greater than zero');
  }
  const out = new Float32Array(maxBoxes * 4);
  endpoints.slice(0, maxBoxes).forEach((endpoint, index) => {
    const left = clip(endpoint.bbox.x, 0, sourceWidth);
    const top = clip(endpoint.bbox.y, 0, sourceHeight);
    const right = clip(endpoint.bbox.x + endpoint.bbox.width, 0, sourceWidth);
    const bottom = clip(endpoint.bbox.y + endpoint.bbox.height, 0, sourceHeight);
    if (!(right > left) || !(bottom > top)) return;

    const offset = index * 4;
    out[offset] = ((left + right) / 2) / sourceWidth;
    out[offset + 1] = ((top + bottom) / 2) / sourceHeight;
    out[offset + 2] = (right - left) / sourceWidth;
    out[offset + 3] = (bottom - top) / sourceHeight;
  });
  return out;
}

export function relateAnythingScore(
  predLogit: number,
  pairLogit: number,
  contract: RelateAnythingScoreContract,
): number {
  if (![predLogit, pairLogit, contract.calibA, contract.calibB, contract.pairWeight].every(Number.isFinite)) {
    return Number.NaN;
  }
  if (!(contract.calibA > 0)) throw new Error('calibA must be > 0');
  const z = contract.calibA * (predLogit + contract.pairWeight * pairLogit) + contract.calibB;
  if (z >= 0) return 1 / (1 + Math.exp(-z));
  const exp = Math.exp(z);
  return exp / (1 + exp);
}

interface ScratchCanvas {
  width: number;
  height: number;
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
}

function createScratchCanvas(width: number, height: number): ScratchCanvas {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Unable to create OffscreenCanvas for relation preprocessing');
    return { width, height, context };
  }
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Unable to create canvas for relation preprocessing');
    return { width, height, context };
  }
  throw new Error('Canvas 2D API is required for default relation preprocessing');
}

function defaultRgbResize(): RelateAnythingRgbResize {
  let scratch: ScratchCanvas | null = null;
  return (source, width, height) => {
    if (!scratch || scratch.width !== width || scratch.height !== height) {
      scratch = createScratchCanvas(width, height);
    }
    scratch.context.clearRect(0, 0, width, height);
    scratch.context.imageSmoothingEnabled = true;
    // RelateAnything uses a direct square resize, not detector-style letterbox.
    scratch.context.drawImage(source, 0, 0, width, height);
    const rgba = scratch.context.getImageData(0, 0, width, height).data;
    const rgb = new Uint8Array(width * height * 3);
    for (let sourceIndex = 0, targetIndex = 0; sourceIndex < rgba.length; sourceIndex += 4) {
      rgb[targetIndex] = rgba[sourceIndex] ?? 0;
      rgb[targetIndex + 1] = rgba[sourceIndex + 1] ?? 0;
      rgb[targetIndex + 2] = rgba[sourceIndex + 2] ?? 0;
      targetIndex += 3;
    }
    return rgb;
  };
}

function rgbToNchw01(rgb: Uint8Array, size: number): Float32Array {
  const plane = size * size;
  if (rgb.length !== plane * 3) {
    throw new Error(`Relation RGB preprocessor returned ${rgb.length} bytes; expected ${plane * 3}`);
  }
  const out = new Float32Array(plane * 3);
  for (let pixel = 0; pixel < plane; pixel += 1) {
    const source = pixel * 3;
    out[pixel] = (rgb[source] ?? 0) / 255;
    out[plane + pixel] = (rgb[source + 1] ?? 0) / 255;
    out[(2 * plane) + pixel] = (rgb[source + 2] ?? 0) / 255;
  }
  return out;
}

function tensorData(outputs: OnnxValueMap, name: string): TensorDataLike {
  const value = outputs[name];
  if (!value || typeof value !== 'object' || !('data' in value)) {
    throw new Error(`Missing tensor data for relation output ${name}`);
  }
  const data = (value as { data?: unknown }).data;
  if (!data || typeof data !== 'object' || !('length' in data)) {
    throw new Error(`Relation output ${name} does not expose array-like data`);
  }
  return data as TensorDataLike;
}

function numericAt(data: TensorDataLike, index: number): number {
  const value = data[index];
  return value === undefined ? Number.NaN : Number(value);
}

function observedThreshold(
  selected: SelectedVocabulary,
  vocabularyIndex: number,
  minScore: number,
  useBankThresholds: boolean,
): number {
  if (!useBankThresholds) return minScore;
  return selected.thresholds[vocabularyIndex] ?? minScore;
}

export class RelateAnythingOnnxProvider implements RelationProvider {
  private readonly contract: RelateAnythingReleaseContract;
  private readonly modelSource: OnnxModelSource;
  private readonly bank: RelateAnythingPredicateBank | undefined;
  private readonly eligibilityMode: RelateAnythingEligibilityMode;
  private readonly minScore: number;
  private readonly maxPredicatesPerPair: number;
  private readonly useBankThresholds: boolean;
  private readonly resizeRgb: RelateAnythingRgbResize;
  private readonly capabilities: OnnxRuntimeCapabilities | undefined;
  private readonly sessionFactory: OnnxSessionFactory | undefined;
  private readonly preferWebGpu: boolean | undefined;
  private session: OnnxSessionLike | null = null;
  private metadata: RelationProviderMetadata | null = null;
  private initializationPromise: Promise<RelationProviderMetadata> | null = null;

  constructor(options: RelateAnythingOnnxProviderOptions) {
    this.contract = {
      ...options.contract,
      predicates: [...options.contract.predicates],
      outputs: { ...options.contract.outputs },
      calibration: { ...options.contract.calibration },
    };
    this.modelSource = options.modelSource;
    this.bank = options.bank;
    this.eligibilityMode = options.eligibilityMode ?? 'experiment';
    this.minScore = validProbability(options.minScore ?? 0.5, 'minScore');
    this.maxPredicatesPerPair = positiveInteger(
      options.maxPredicatesPerPair ?? 1,
      'maxPredicatesPerPair',
    );
    this.useBankThresholds = options.useBankThresholds ?? true;
    this.resizeRgb = options.resizeRgb ?? defaultRgbResize();
    this.capabilities = options.capabilities;
    this.sessionFactory = options.sessionFactory;
    this.preferWebGpu = options.preferWebGpu;
    assertEligibility(this.contract, this.eligibilityMode);
    if (this.contract.vocabMode === 'input' && this.bank) {
      assertBank(this.bank, this.contract.textDim);
    }
  }

  async initialize(): Promise<RelationProviderMetadata> {
    if (this.metadata) return { ...this.metadata };
    if (this.initializationPromise) return this.initializationPromise;
    this.initializationPromise = this.initializeOnce();
    try {
      return await this.initializationPromise;
    } finally {
      this.initializationPromise = null;
    }
  }

  getMetadata(): RelationProviderMetadata | null {
    return this.metadata ? { ...this.metadata } : null;
  }

  async score(input: RelationInput): Promise<RelationObservation[]> {
    const session = this.session;
    if (!session || !this.metadata) {
      throw new Error('RelateAnythingOnnxProvider must be initialized before score()');
    }
    if (!(input.sourceWidth > 0) || !(input.sourceHeight > 0)) {
      throw new Error('Relation source dimensions must be greater than zero');
    }
    if (!Number.isFinite(input.timestampMs)) throw new Error('Relation timestampMs must be finite');
    if (input.candidates.length === 0) return [];

    const plan = buildEndpointPlan(input.candidates, this.contract.maxBoxes);
    if (plan.endpoints.length < 2 || plan.allowedPairs.size === 0) return [];
    const selected = selectVocabulary(input.vocabulary, this.contract, this.bank);
    const rgb = await this.resizeRgb(input.source, this.contract.imgSize, this.contract.imgSize);
    const imageData = rgbToNchw01(rgb, this.contract.imgSize);
    const boxData = relationBoxesCxCyWh(
      plan.endpoints,
      input.sourceWidth,
      input.sourceHeight,
      this.contract.maxBoxes,
    );

    const feeds: OnnxValueMap = {
      image: new ort.Tensor('float32', imageData, [1, 3, this.contract.imgSize, this.contract.imgSize]),
      boxes: new ort.Tensor('float32', boxData, [1, this.contract.maxBoxes, 4]),
      box_counts: new ort.Tensor('int64', BigInt64Array.from([BigInt(plan.endpoints.length)]), [1]),
    };
    if (this.contract.vocabMode === 'input') {
      if (!selected.W || !selected.alpha) {
        throw new Error('Dynamic RelateAnything vocabulary tensors were not prepared');
      }
      feeds.W = new ort.Tensor('float32', selected.W, [selected.names.length, this.contract.textDim]);
      feeds.alpha = new ort.Tensor('float32', selected.alpha, [selected.names.length]);
    }

    let outputs: OnnxValueMap | null = null;
    try {
      outputs = await session.run(feeds);
      return this.decode(outputs, plan, selected, input.timestampMs);
    } finally {
      if (outputs) await disposeOnnxValues(outputs);
      await disposeOnnxValues(feeds);
    }
  }

  async dispose(): Promise<void> {
    const pending = this.initializationPromise;
    if (pending) {
      try {
        await pending;
      } catch {
        // Session creation may have failed after allocating partial resources.
      }
    }
    const session = this.session;
    this.session = null;
    this.metadata = null;
    if (session) await session.release();
  }

  private async initializeOnce(): Promise<RelationProviderMetadata> {
    assertEligibility(this.contract, this.eligibilityMode);
    const selection = await createOnnxSessionWithFallback(this.modelSource, {
      ...(this.capabilities === undefined ? {} : { capabilities: this.capabilities }),
      ...(this.sessionFactory === undefined ? {} : { factory: this.sessionFactory }),
      ...(this.preferWebGpu === undefined ? {} : { preferWebGpu: this.preferWebGpu }),
    });
    this.session = selection.session;
    this.metadata = {
      providerId: this.contract.providerId,
      modelId: this.contract.modelId,
      modelVersion: this.contract.modelVersion,
      runtime: 'onnxruntime-web',
      // Upstream exports only the selected/final relation pairs and this
      // adapter additionally applies thresholds. Missing output is therefore
      // not valid negative evidence for an arbitrary requested pair.
      scoreSemantics: 'thresholded_partial',
      backend: selection.runtime.backend,
      ...(this.contract.sourceUrl === undefined ? {} : { sourceUrl: this.contract.sourceUrl }),
      ...(this.contract.codeLicense === undefined ? {} : { codeLicense: this.contract.codeLicense }),
      ...(this.contract.weightsLicense === undefined ? {} : { weightsLicense: this.contract.weightsLicense }),
      weightsRedistributionVerified: this.contract.weightsRedistributionVerified,
    };
    return { ...this.metadata };
  }

  private decode(
    outputs: OnnxValueMap,
    plan: EndpointPlan,
    selected: SelectedVocabulary,
    timestampMs: number,
  ): RelationObservation[] {
    const names = this.contract.outputs;
    const pred = tensorData(outputs, names.predLogits);
    const pair = tensorData(outputs, names.pairLogits);
    const sub = tensorData(outputs, names.subjectIndex);
    const obj = tensorData(outputs, names.objectIndex);
    const valid = tensorData(outputs, names.validMask);
    const vocabularySize = selected.names.length;
    const pairCount = Math.min(
      pair.length,
      sub.length,
      obj.length,
      valid.length,
      Math.floor(pred.length / vocabularySize),
    );

    const best = new Map<string, RelationObservation>();
    const scoreContract: RelateAnythingScoreContract = {
      calibA: this.contract.calibration.a,
      calibB: this.contract.calibration.b,
      pairWeight: this.contract.pairWeight,
    };

    for (let pairIndex = 0; pairIndex < pairCount; pairIndex += 1) {
      if (!Boolean(numericAt(valid, pairIndex))) continue;
      const subjectIndex = Math.trunc(numericAt(sub, pairIndex));
      const objectIndex = Math.trunc(numericAt(obj, pairIndex));
      if (
        subjectIndex < 0
        || objectIndex < 0
        || subjectIndex >= plan.endpoints.length
        || objectIndex >= plan.endpoints.length
        || subjectIndex === objectIndex
      ) {
        continue;
      }
      const subject = plan.endpoints[subjectIndex];
      const object = plan.endpoints[objectIndex];
      if (!subject || !object || !plan.allowedPairs.has(pairKey(subject, object))) continue;

      const pairLogit = numericAt(pair, pairIndex);
      if (!Number.isFinite(pairLogit)) continue;

      const perPair: RelationObservation[] = [];
      for (let vocabularyIndex = 0; vocabularyIndex < vocabularySize; vocabularyIndex += 1) {
        const predLogit = numericAt(pred, pairIndex * vocabularySize + vocabularyIndex);
        const score = relateAnythingScore(predLogit, pairLogit, scoreContract);
        if (!Number.isFinite(score)) continue;
        const threshold = observedThreshold(
          selected,
          vocabularyIndex,
          this.minScore,
          this.useBankThresholds,
        );
        if (score < threshold) continue;
        const predicate = selected.names[vocabularyIndex];
        if (!predicate) continue;
        perPair.push({
          subjectId: subject.id,
          objectId: object.id,
          predicate,
          score,
          timestampMs,
          providerId: this.contract.providerId,
        });
      }

      perPair.sort((a, b) => b.score - a.score);
      for (const observation of perPair.slice(0, this.maxPredicatesPerPair)) {
        const key = JSON.stringify([
          observation.subjectId,
          observation.predicate,
          observation.objectId,
        ]);
        const previous = best.get(key);
        if (!previous || observation.score > previous.score) best.set(key, observation);
      }
    }

    return [...best.values()].sort((a, b) => b.score - a.score);
  }
}
