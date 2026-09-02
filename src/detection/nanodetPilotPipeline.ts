import type { NormalizedDirectedLine } from '../geometry/normalized';
import type { EdgeMobilityPipelineFrame } from '../pipeline/edgeMobilityPipeline';
import { EdgeMobilityPipeline } from '../pipeline/edgeMobilityPipeline';
import type { NodePilotPipeline, NodePilotPipelineSnapshot } from '../node/pilotPipeline';
import type { DetectorInitialization, DetectorInput } from './types';
import {
  loadNanoDetPilot,
  type NanoDetPilotLoadResult,
  type NanoDetPilotLoaderOptions,
} from './onnx/nanodetPilot';

const PILOT_NAME = 'NanoDet piloto';

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

function cloneLines(lines: readonly NormalizedDirectedLine[]): NormalizedDirectedLine[] {
  return lines.map((line) => ({
    ...line,
    a: { ...line.a },
    b: { ...line.b },
  }));
}

/**
 * Lazy semantic processor used by RuntimeInferenceBridge. The external model is
 * not downloaded until the user actually starts the node and inference needs to
 * initialize. Counting geometry may be supplied before or after initialization;
 * every runtime replacement is delegated to EdgeMobilityPipeline's reset-safe
 * geometry boundary.
 */
export class NanoDetPilotPipeline implements NodePilotPipeline {
  private readonly options: NanoDetPilotPipelineOptions;
  private readonly loader: NanoDetPilotLoader;
  private pipeline: EdgeMobilityPipeline | null = null;
  private initialization: DetectorInitialization | null = null;
  private initializationPromise: Promise<DetectorInitialization> | null = null;
  private countingLines: NormalizedDirectedLine[] = [];
  private state: NodePilotPipelineSnapshot = {
    state: 'idle',
    displayName: PILOT_NAME,
  };
  private disposed = false;

  constructor(options: NanoDetPilotPipelineOptions = {}) {
    this.options = options;
    this.loader = options.loader ?? loadNanoDetPilot;
  }

  snapshot(): NodePilotPipelineSnapshot {
    return { ...this.state };
  }

  getInitialization(): DetectorInitialization | null {
    return this.initialization;
  }

  setCountingLines(lines: readonly NormalizedDirectedLine[]): void {
    if (this.disposed) return;
    this.countingLines = cloneLines(lines);
    this.pipeline?.setCountingLines(this.countingLines);
  }

  initialize(): Promise<DetectorInitialization> {
    if (this.disposed) return Promise.reject(new Error('NanoDet pilot pipeline is disposed'));
    if (this.initialization) return Promise.resolve(this.initialization);
    if (this.initializationPromise) return this.initializationPromise;

    this.state = { state: 'loading', displayName: PILOT_NAME };
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
    this.countingLines = [];
    this.state = { state: 'disposed', displayName: PILOT_NAME };
  }

  private async initializeOnce(): Promise<DetectorInitialization> {
    let candidatePipeline: EdgeMobilityPipeline | null = null;
    try {
      const loaded = await this.loader(this.options);
      if (this.disposed) {
        await loaded.detector.dispose();
        throw new Error('NanoDet pilot pipeline was disposed during initialization');
      }

      candidatePipeline = new EdgeMobilityPipeline(loaded.detector, {
        sessionId: this.options.sessionId ?? localSessionId(),
        ...(this.countingLines.length === 0 ? {} : { countingLines: this.countingLines }),
      });
      this.pipeline = candidatePipeline;
      const initialization = await candidatePipeline.initialize();
      if (this.disposed) {
        await candidatePipeline.dispose();
        if (this.pipeline === candidatePipeline) this.pipeline = null;
        throw new Error('NanoDet pilot pipeline was disposed during initialization');
      }

      // A geometry update can arrive while the external model is loading. Reapply
      // the latest value after initialization so the runtime cannot start with a
      // stale constructor snapshot.
      candidatePipeline.setCountingLines(this.countingLines);
      this.initialization = initialization;
      this.state = {
        state: 'ready',
        displayName: PILOT_NAME,
        candidateId: loaded.candidateId,
        modelSha256: loaded.modelSha256,
        artifactSource: loaded.artifactSource,
        cachePersisted: loaded.cachePersisted,
        backend: initialization.runtime.backend,
      };
      return initialization;
    } catch (error) {
      if (candidatePipeline && this.pipeline === candidatePipeline) {
        try {
          await candidatePipeline.dispose();
        } catch {
          // Preserve the initialization error. Cleanup failure must not mask it.
        }
        this.pipeline = null;
      }
      this.initialization = null;
      this.state = {
        state: 'error',
        displayName: PILOT_NAME,
        error: normalizeError(error),
      };
      throw error;
    } finally {
      this.initializationPromise = null;
    }
  }
}
