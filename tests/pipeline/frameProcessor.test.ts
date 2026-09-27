import { describe, expect, it } from 'vitest';
import type {
  Detector,
  DetectorInitialization,
  DetectorInput,
  DetectorOutput,
} from '../../src/detection/types';
import type { RawDetection } from '../../src/core/types';
import { MobilityFrameProcessor } from '../../src/pipeline/frameProcessor';

function detection(
  className: string,
  x: number,
  y: number,
  width: number,
  height: number,
  confidence = 0.94,
): RawDetection {
  return {
    classId: 0,
    className,
    confidence,
    bbox: { x, y, width, height },
  };
}

class SequenceDetector implements Detector {
  private initialized: DetectorInitialization | null = null;
  private frameIndex = 0;
  initializeCalls = 0;
  disposeCalls = 0;

  constructor(private readonly frames: RawDetection[][]) {}

  async initialize(): Promise<DetectorInitialization> {
    this.initializeCalls += 1;
    this.initialized = {
      model: {
        adapterId: 'mock',
        modelId: 'mock-mobility',
        modelVersion: '1',
        weightsRedistributionVerified: true,
        inputWidth: 640,
        inputHeight: 640,
        classNames: ['person', 'bicycle', 'car'],
      },
      runtime: {
        runtime: 'other',
        backend: 'unknown',
        executionProviders: ['unknown'],
      },
    };
    return this.initialized;
  }

  async detect(input: DetectorInput): Promise<DetectorOutput> {
    const detections = this.frames[Math.min(this.frameIndex, this.frames.length - 1)] ?? [];
    this.frameIndex += 1;
    return {
      detections,
      timestampMs: input.timestampMs,
      telemetry: {
        preprocessMs: 1,
        inferenceMs: 10,
        postprocessMs: 2,
        totalMs: 13,
        detectionCountBeforeFiltering: detections.length,
        detectionCount: detections.length,
      },
    };
  }

  dispose(): void {
    this.disposeCalls += 1;
    this.initialized = null;
  }

  getInitialization(): DetectorInitialization | null {
    return this.initialized;
  }
}

const fakeSource = {} as CanvasImageSource;

describe('mobility frame processor', () => {
  it('requires explicit detector initialization', async () => {
    const detector = new SequenceDetector([[]]);
    const processor = new MobilityFrameProcessor(detector);

    await expect(processor.process({
      source: fakeSource,
      sourceWidth: 1280,
      sourceHeight: 720,
      timestampMs: 1000,
    })).rejects.toThrow(/initialized/i);
  });

  it('converts person+bicycle into one cyclist and matures persistent tracks', async () => {
    const frames = [0, 1, 2].map((step) => [
      detection('person', 100 + step * 8, 50, 40, 100, 0.96),
      detection('bicycle', 80 + step * 8, 120, 100, 50, 0.94),
      detection('car', 400 - step * 10, 100, 150, 80, 0.92),
    ]);
    const detector = new SequenceDetector(frames);
    const processor = new MobilityFrameProcessor(detector);
    await processor.initialize();

    const outputs = [];
    for (let index = 0; index < 3; index += 1) {
      outputs.push(await processor.process({
        source: fakeSource,
        sourceWidth: 1280,
        sourceHeight: 720,
        timestampMs: 1000 + index * 200,
      }));
    }

    const first = outputs[0];
    const last = outputs[2];
    expect(first?.fusion.entities.map((entity) => entity.entityType).sort()).toEqual(['car', 'cyclist']);
    expect(first?.fusion.entities.some((entity) => entity.entityType === 'pedestrian')).toBe(false);
    expect(last?.tracking.confirmedTracks).toHaveLength(2);
    expect(last?.tracking.confirmedTracks.map((track) => track.entityType).sort()).toEqual(['car', 'cyclist']);
    expect(new Set(last?.tracking.confirmedTracks.map((track) => track.id)).size).toBe(2);
  });

  it('initializes only once and disposes the detector explicitly', async () => {
    const detector = new SequenceDetector([[]]);
    const processor = new MobilityFrameProcessor(detector);

    await processor.initialize();
    await processor.initialize();
    expect(detector.initializeCalls).toBe(1);

    await processor.dispose();
    expect(detector.disposeCalls).toBe(1);
    expect(processor.getInitialization()).toBeNull();
  });
});
