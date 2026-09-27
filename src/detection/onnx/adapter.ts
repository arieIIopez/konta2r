import type { RawDetection } from '../../core/types';
import {
  assertBundledModelEligible,
  evaluateModelEligibility,
  type RegisteredDetectorModel,
} from '../modelRegistry';
import type {
  Detector,
  DetectorInitialization,
  DetectorInput,
  DetectorOutput,
} from '../types';
import type { OnnxDetectorCodec } from './codec';
import {
  createOnnxSessionWithFallback,
  disposeOnnxValues,
  type OnnxModelSource,
  type OnnxRuntimeCapabilities,
  type OnnxSessionFactory,
  type OnnxSessionLike,
} from './runtime';

export type OnnxAdapterEligibilityMode = 'experiment' | 'bundled_production';

export interface OnnxDetectorAdapterOptions<TContext> {
  model: RegisteredDetectorModel;
  modelSource: OnnxModelSource;
  codec: OnnxDetectorCodec<TContext>;
  eligibilityMode?: OnnxAdapterEligibilityMode;
  maxDetections?: number | (() => number);
  minConfidence?: number;
  capabilities?: OnnxRuntimeCapabilities;
  sessionFactory?: OnnxSessionFactory;
  preferWebGpu?: boolean;
}

export interface OnnxAdapterRuntimeDiagnostics {
  webgpuAttempted: boolean;
  fallbackReason?: string;
}

function cloneModel(model: RegisteredDetectorModel): RegisteredDetectorModel {
  return {
    ...model,
    classNames: [...model.classNames],
    ...(model.notes === undefined ? {} : { notes: [...model.notes] }),
  };
}

function validDetection(detection: RawDetection): boolean {
  const { bbox } = detection;
  return detection.className.trim().length > 0
    && Number.isFinite(detection.confidence)
    && detection.confidence >= 0
    && detection.confidence <= 1
    && Number.isFinite(bbox.x)
    && Number.isFinite(bbox.y)
    && Number.isFinite(bbox.width)
    && Number.isFinite(bbox.height)
    && bbox.width > 0
    && bbox.height > 0;
}

function resolvedMaxDetections(value: number | (() => number) | undefined): number {
  const resolved = typeof value === 'function' ? value() : value ?? Number.POSITIVE_INFINITY;
  if (resolved === Number.POSITIVE_INFINITY) return resolved;
  if (!Number.isFinite(resolved) || resolved < 1) {
    throw new Error('maxDetections must resolve to a finite value greater than or equal to one');
  }
  return Math.floor(resolved);
}

function validateConfidence(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error('minConfidence must be within [0, 1]');
  }
  return value;
}

/**
 * Generic ONNX Runtime Web detector shell. Model-specific image normalization,
 * tensor names, NMS and output parsing are delegated to OnnxDetectorCodec.
 */
export class OnnxDetectorAdapter<TContext = unknown> implements Detector {
  private readonly model: RegisteredDetectorModel;
  private readonly modelSource: OnnxModelSource;
  private readonly codec: OnnxDetectorCodec<TContext>;
  private readonly eligibilityMode: OnnxAdapterEligibilityMode;
  private readonly maxDetections: number | (() => number) | undefined;
  private readonly minConfidence: number;
  private readonly capabilities: OnnxRuntimeCapabilities | undefined;
  private readonly sessionFactory: OnnxSessionFactory | undefined;
  private readonly preferWebGpu: boolean | undefined;
  private session: OnnxSessionLike | null = null;
  private initialization: DetectorInitialization | null = null;
  private initializationPromise: Promise<DetectorInitialization> | null = null;
  private diagnostics: OnnxAdapterRuntimeDiagnostics | null = null;

  constructor(options: OnnxDetectorAdapterOptions<TContext>) {
    this.model = cloneModel(options.model);
    this.modelSource = options.modelSource;
    this.codec = options.codec;
    this.eligibilityMode = options.eligibilityMode ?? 'experiment';
    this.maxDetections = options.maxDetections;
    this.minConfidence = validateConfidence(options.minConfidence ?? 0);
    this.capabilities = options.capabilities;
    this.sessionFactory = options.sessionFactory;
    this.preferWebGpu = options.preferWebGpu;
    resolvedMaxDetections(this.maxDetections);
  }

  async initialize(): Promise<DetectorInitialization> {
    if (this.initialization) return this.initialization;
    if (this.initializationPromise) return this.initializationPromise;

    this.initializationPromise = this.initializeOnce();
    try {
      return await this.initializationPromise;
    } finally {
      this.initializationPromise = null;
    }
  }

  getInitialization(): DetectorInitialization | null {
    return this.initialization
      ? {
          model: { ...this.initialization.model, classNames: [...this.initialization.model.classNames] },
          runtime: {
            ...this.initialization.runtime,
            executionProviders: [...this.initialization.runtime.executionProviders],
          },
        }
      : null;
  }

  getRuntimeDiagnostics(): OnnxAdapterRuntimeDiagnostics | null {
    return this.diagnostics ? { ...this.diagnostics } : null;
  }

  async detect(input: DetectorInput): Promise<DetectorOutput> {
    const session = this.session;
    if (!session || !this.initialization) {
      throw new Error('OnnxDetectorAdapter must be initialized before detect()');
    }

    const startedAt = performance.now();
    const preprocessStartedAt = startedAt;
    const prepared = await this.codec.prepare(input);
    const preprocessMs = Math.max(0, performance.now() - preprocessStartedAt);
    let outputs: Record<string, unknown> | null = null;

    try {
      const inferenceStartedAt = performance.now();
      outputs = await session.run(prepared.feeds);
      const inferenceMs = Math.max(0, performance.now() - inferenceStartedAt);

      const postprocessStartedAt = performance.now();
      const decoded = await this.codec.decode(outputs, prepared.context, input);
      const detectionCountBeforeFiltering = decoded.length;
      const maxDetections = resolvedMaxDetections(this.maxDetections);
      const detections = decoded
        .filter((detection) => validDetection(detection) && detection.confidence >= this.minConfidence)
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, maxDetections)
        .map((detection) => ({ ...detection, bbox: { ...detection.bbox } }));
      const postprocessMs = Math.max(0, performance.now() - postprocessStartedAt);
      const totalMs = Math.max(0, performance.now() - startedAt);

      return {
        detections,
        timestampMs: input.timestampMs,
        telemetry: {
          preprocessMs,
          inferenceMs,
          postprocessMs,
          totalMs,
          detectionCountBeforeFiltering,
          detectionCount: detections.length,
        },
      };
    } finally {
      if (outputs) await disposeOnnxValues(outputs);
      await prepared.dispose?.();
    }
  }

  async dispose(): Promise<void> {
    const pendingInitialization = this.initializationPromise;
    if (pendingInitialization) {
      try {
        await pendingInitialization;
      } catch {
        // Partial initialization may still have allocated runtime resources.
      }
    }

    const session = this.session;
    this.session = null;
    this.initialization = null;
    this.diagnostics = null;
    if (session) await session.release();
  }

  private async initializeOnce(): Promise<DetectorInitialization> {
    if (this.eligibilityMode === 'bundled_production') {
      assertBundledModelEligible(this.model);
    } else {
      const eligibility = evaluateModelEligibility(this.model);
      if (!eligibility.eligibleForExperiment) {
        throw new Error(`Detector model is not eligible for experiment: ${eligibility.reasons.join(', ')}`);
      }
    }

    const selection = await createOnnxSessionWithFallback(this.modelSource, {
      ...(this.capabilities === undefined ? {} : { capabilities: this.capabilities }),
      ...(this.sessionFactory === undefined ? {} : { factory: this.sessionFactory }),
      ...(this.preferWebGpu === undefined ? {} : { preferWebGpu: this.preferWebGpu }),
    });
    this.session = selection.session;
    this.diagnostics = {
      webgpuAttempted: selection.webgpuAttempted,
      ...(selection.fallbackReason === undefined ? {} : { fallbackReason: selection.fallbackReason }),
    };
    this.initialization = {
      model: {
        ...this.model,
        classNames: [...this.model.classNames],
      },
      runtime: {
        ...selection.runtime,
        executionProviders: [...selection.runtime.executionProviders],
      },
    };
    return this.getInitialization() as DetectorInitialization;
  }
}
