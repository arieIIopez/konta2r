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

function cloneLines(lines: readonly NormalizedDirectedLine[]): NormalizedDirectedLine[] {
  return lines.map((line) => ({
    ...line,
    a: { ...line.a },
    b: { ...line.b },
  }));
}

/**
 * End-to-end semantic pipeline executed on the node. It deliberately ends at
 * local event records; Community aggregation/synchronization is a separate
 * boundary so event-level track data never needs to be uploaded.
 */
export class EdgeMobilityPipeline {
  private readonly frameProcessor: MobilityFrameProcessor;
  private readonly sessionId: string;
  private readonly countingOptions: CountingEngineOptions | undefined;
  private countingEngine: TrackCountingEngine | null = null;
  private countingLines: NormalizedDirectedLine[] = [];

  constructor(detector: Detector, options: EdgeMobilityPipelineOptions) {
    if (options.sessionId.trim().length === 0) throw new Error('sessionId is required');
    this.sessionId = options.sessionId;
    this.countingOptions = options.counting;
    this.frameProcessor = new MobilityFrameProcessor(detector, {
      ...(options.fusion === undefined ? {} : { fusion: options.fusion }),
      ...(options.tracker === undefined ? {} : { tracker: options.tracker }),
    });
    if (options.countingLines && options.countingLines.length > 0) {
      this.countingLines = cloneLines(options.countingLines);
      this.countingEngine = new TrackCountingEngine(this.countingLines, this.countingOptions);
    }
  }

  initialize(): Promise<DetectorInitialization> {
    return this.frameProcessor.initialize();
  }

  getInitialization(): DetectorInitialization | null {
    return this.frameProcessor.getInitialization();
  }

  getCountingLines(): NormalizedDirectedLine[] {
    return cloneLines(this.countingLines);
  }

  /**
   * Replaces the operational counting geometry. This is an explicit state
   * boundary: all tracker history and line-event hysteresis are reset before the
   * new geometry can observe a frame, so an old trajectory cannot manufacture a
   * crossing under a newly edited line. Passing an empty array disables counting.
   */
  setCountingLines(lines: readonly NormalizedDirectedLine[]): void {
    const nextLines = cloneLines(lines);
    this.frameProcessor.resetTracking();
    this.countingEngine?.reset();
    this.countingLines = nextLines;
    this.countingEngine = nextLines.length > 0
      ? new TrackCountingEngine(nextLines, this.countingOptions)
      : null;
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
    this.countingEngine = null;
    this.countingLines = [];
    await this.frameProcessor.dispose();
  }
}
