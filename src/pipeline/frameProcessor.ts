import type { ModalFusionConfig, ModalFusionResult } from '../fusion/modalFusion';
import { fuseModalDetections } from '../fusion/modalFusion';
import {
  MultiObjectTracker,
  type MultiObjectTrackerConfig,
  type TrackerUpdateResult,
} from '../tracking/multiObjectTracker';
import type {
  Detector,
  DetectorInitialization,
  DetectorInput,
  DetectorOutput,
} from '../detection/types';

export interface MobilityFrameProcessorOptions {
  fusion?: Partial<ModalFusionConfig>;
  tracker?: Partial<MultiObjectTrackerConfig>;
}

export interface MobilityProcessedFrame {
  timestampMs: number;
  detector: DetectorOutput;
  fusion: ModalFusionResult;
  tracking: TrackerUpdateResult;
  pipelineMs: number;
}

/**
 * One deterministic semantic step of Konta2r's edge pipeline:
 * raw detector boxes -> mobility users -> persistent local tracks.
 *
 * Pixel/frame data never leaves this class through a network contract. The
 * returned records contain only detector metadata, modal observations and
 * local temporal tracks for subsequent spatial/event processing.
 */
export class MobilityFrameProcessor {
  private readonly detector: Detector;
  private readonly tracker: MultiObjectTracker;
  private readonly fusionConfig: Partial<ModalFusionConfig>;
  private initialization: DetectorInitialization | null = null;

  constructor(detector: Detector, options: MobilityFrameProcessorOptions = {}) {
    this.detector = detector;
    this.tracker = new MultiObjectTracker(options.tracker);
    this.fusionConfig = { ...options.fusion };
  }

  async initialize(): Promise<DetectorInitialization> {
    if (this.initialization) return this.initialization;
    this.initialization = await this.detector.initialize();
    return this.initialization;
  }

  getInitialization(): DetectorInitialization | null {
    return this.initialization ?? this.detector.getInitialization();
  }

  resetTracking(): void {
    this.tracker.reset();
  }

  async process(input: DetectorInput): Promise<MobilityProcessedFrame> {
    if (!this.getInitialization()) {
      throw new Error('MobilityFrameProcessor must be initialized before processing frames');
    }
    if (!(input.sourceWidth > 0) || !(input.sourceHeight > 0)) {
      throw new Error('Detector source dimensions must be greater than zero');
    }

    const startedAt = performance.now();
    const detector = await this.detector.detect(input);
    const timestampMs = Number.isFinite(detector.timestampMs)
      ? detector.timestampMs
      : input.timestampMs;
    const fusion = fuseModalDetections(detector.detections, this.fusionConfig);
    const tracking = this.tracker.update(fusion.entities, timestampMs);
    const pipelineMs = Math.max(0, performance.now() - startedAt);

    return {
      timestampMs,
      detector,
      fusion,
      tracking,
      pipelineMs,
    };
  }

  async dispose(): Promise<void> {
    this.tracker.reset();
    this.initialization = null;
    await this.detector.dispose();
  }
}
