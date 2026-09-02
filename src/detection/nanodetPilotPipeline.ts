import type { DetectorInitialization, DetectorInput } from './types';
import type { EdgeMobilityPipelineFrame } from '../pipeline/edgeMobilityPipeline';
import { EdgeMobilityPipeline } from '../pipeline/edgeMobilityPipeline';
import {
  loadNanoDetPilot,
  type NanoDetPilotArtifactSource,
  type NanoDetPilotLoadResult,
  type NanoDetPilotLoaderOptions,
} from './onnx/nanodetPilot';

export interface NanoDetPilotPipelineSnapshot {
  state: 'idle' | 'loading' | 'ready' | 'error' | 'disposed';
  candidateId?: string;
  modelSha256?: string;
  artifactSource?: NanoDetPilotArtifactSource;
  cachePersisted?: boolean;
  backend?: DetectorInitialization['runtime']['backend'];
  error?: string;
}

export type NanoDetPilotLoader = (
  options: NanoDetPilotLoaderOptions,
) => Promise<NanoDetPilotLoadResult>;

export interface NanoDetPilotPipelineOptions extends NanoDetPilotLoaderOptions {
  sessionId?: string;
  loader?: NanoDetPilotLoader;
}

function localSessionId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return `session_pilot_${uuid ?? Math.random().toString(36).slice(2)}`;
}

function normalizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Lazy semantic processor used by RuntimeInferenceBridge. The external model is
 * not downloaded until the user actually starts the node and inference needs to
 * initialize. No counting line is injected here: this stage measures detector,
 * fusion and tracking behavior without inventing a camera geometry.
 */
export class NanoDetPilotPipeline {
  private readonly options: NanoDetPilotPipelineOptions;
  private readonly loader: NanoDetPilotLoader;
  private pipeline: EdgeMobilityPipeline | null = null;
  private initialization: DetectorInitialization | null = null;
  private initializationPromise: Promise<DetectorInitialization> | null = null;
  private state: NanoDetPilotPipelineSnapshot = { state: 'idle' };
  private disposed = false;

  constructor(options: NanoDetPilotPipelineOptions = {}) {
    this.options = options;
    this.loader = options.loader ?? loadNanoDetPilot;
  }

  snapshot(): NanoDetPilotPipelineSnapshot {
    return { ...this.state };
  }

  getInitialization(): DetectorInitialization | null {
    return this.initialization;
  }

  initialize(): Promise<DetectorInitialization> {
    if (this.disposed) return Promise.reject(new Error('NanoDet pilot pipeline is disposed'));
    if (this.initialization) return Promise.resolve(this.initialization);
    if (this.initializationPromise) return this.initializationPromise;

    this.state = { state: 'loading' };
    this.initializationPromise = this.initializeOnce();
    return this.initializationPromise;
  }

  async process(input: DetectorInput): Promise<EdgeMobilityPipelineFrame> {
    if (!this.initialization) await this.initialize();
    if (!this.pipeline) throw new Error('NanoDet pilot pipeline did not initialize');
    return this.pipeline.process(input);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    const pending = this.initializationPromise;
    if (pending) {
      try {
        await pending;
      } catch {
        // Initialization failures are already reflected in snapshot state.
      }
    }
    await this.pipeline?.dispose();
    this.pipeline = null;
    this.initialization = null;
    this.initializationPromise = null;
    this.state = { state: 'disposed' };
  }

  private async initializeOnce(): Promise<DetectorInitialization> {
    try {
      const loaded = await this.loader(this.options);
      if (this.disposed) {
        await loaded.detector.dispose();
        throw new Error('NanoDet pilot pipeline was disposed during initialization');
      }
      const pipeline = new EdgeMobilityPipeline(loaded.detector, {
        sessionId: this.options.sessionId ?? localSessionId(),
      });
      this.pipeline = pipeline;
      const initialization = await pipeline.initialize();
      this.initialization = initialization;
      this.state = {
        state: 'ready',
        candidateId: loaded.candidateId,
        modelSha256: loaded.modelSha256,
        artifactSource: loaded.artifactSource,
        cachePersisted: loaded.cachePersisted,
        backend: initialization.runtime.backend,
      };
      return initialization;
    } catch (error) {
      this.pipeline = null;
      this.initialization = null;
      this.initializationPromise = null;
      this.state = { state: 'error', error: normalizeError(error) };
      throw error;
    }
  }
}
