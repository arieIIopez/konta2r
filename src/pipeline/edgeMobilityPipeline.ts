import type { LineCrossingEvent } from '../core/types';
import type { Detector, DetectorInitialization, DetectorInput } from '../detection/types';
import type { NormalizedDirectedLine } from '../geometry/normalized';
import {
  MobilityFrameProcessor,
  type MobilityFrameProcessorOptions,
  type MobilityProcessedFrame,
} from './frameProcessor';
import { TrackCountingEngine, type CountingEngineOptions } from './countingEngine';

export interface EdgeMobilityPipelineOptions extends MobilityFrameProcessorOptions {
  sessionId: string;
  countingLines?: readonly NormalizedDirectedLine[];
  counting?: CountingEngineOptions;
}

export interface EdgeMobilityPipelineFrame extends MobilityProcessedFrame {
  crossings: LineCrossingEvent[];
}

/**
 * End-to-end semantic pipeline executed on the node. It deliberately ends at
 * local event records; Community aggregation/synchronization is a separate
 * boundary so event-level track data never needs to be uploaded.
 */
export class EdgeMobilityPipeline {
  private readonly frameProcessor: MobilityFrameProcessor;
  private readonly countingEngine: TrackCountingEngine | null;
  private readonly sessionId: string;

  constructor(detector: Detector, options: EdgeMobilityPipelineOptions) {
    if (options.sessionId.trim().length === 0) throw new Error('sessionId is required');
    this.sessionId = options.sessionId;
    this.frameProcessor = new MobilityFrameProcessor(detector, {
      ...(options.fusion === undefined ? {} : { fusion: options.fusion }),
      ...(options.tracker === undefined ? {} : { tracker: options.tracker }),
    });
    this.countingEngine = options.countingLines && options.countingLines.length > 0
      ? new TrackCountingEngine(options.countingLines, options.counting)
      : null;
  }

  initialize(): Promise<DetectorInitialization> {
    return this.frameProcessor.initialize();
  }

  getInitialization(): DetectorInitialization | null {
    return this.frameProcessor.getInitialization();
  }

  async process(input: DetectorInput): Promise<EdgeMobilityPipelineFrame> {
    const frame = await this.frameProcessor.process(input);
    const crossings = this.countingEngine?.update(
      frame.tracking,
      input.sourceWidth,
      input.sourceHeight,
      frame.timestampMs,
      this.sessionId,
    ) ?? [];
    return { ...frame, crossings };
  }

  resetTrackingAndEvents(): void {
    this.frameProcessor.resetTracking();
    this.countingEngine?.reset();
  }

  async dispose(): Promise<void> {
    this.countingEngine?.reset();
    await this.frameProcessor.dispose();
  }
}
