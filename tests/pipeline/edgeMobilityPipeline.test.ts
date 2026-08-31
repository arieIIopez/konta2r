import { describe, expect, it } from 'vitest';
import type {
  Detector,
  DetectorInitialization,
  DetectorInput,
  DetectorOutput,
} from '../../src/detection/types';
import type { RawDetection } from '../../src/core/types';
import { EdgeMobilityPipeline } from '../../src/pipeline/edgeMobilityPipeline';

function raw(
  className: string,
  x: number,
  y: number,
  width: number,
  height: number,
  confidence = 0.95,
): RawDetection {
  return { classId: 0, className, confidence, bbox: { x, y, width, height } };
}

function riderFrame(centerX: number): RawDetection[] {
  return [
    raw('person', centerX - 20, 120, 40, 120, 0.97),
    raw('bicycle', centerX - 55, 205, 110, 55, 0.95),
  ];
}

class MockDetector implements Detector {
  private init: DetectorInitialization | null = null;
  private index = 0;

  constructor(private readonly frames: RawDetection[][]) {}

  async initialize(): Promise<DetectorInitialization> {
    this.init = {
      model: {
        adapterId: 'mock',
        modelId: 'mock',
        modelVersion: '1',
        weightsRedistributionVerified: true,
        inputWidth: 640,
        inputHeight: 640,
        classNames: ['person', 'bicycle'],
      },
      runtime: { runtime: 'other', backend: 'unknown', executionProviders: ['unknown'] },
    };
    return this.init;
  }

  async detect(input: DetectorInput): Promise<DetectorOutput> {
    const detections = this.frames[Math.min(this.index, this.frames.length - 1)] ?? [];
    this.index += 1;
    return {
      detections,
      timestampMs: input.timestampMs,
      telemetry: {
        preprocessMs: 1,
        inferenceMs: 8,
        postprocessMs: 1,
        totalMs: 10,
        detectionCountBeforeFiltering: detections.length,
        detectionCount: detections.length,
      },
    };
  }

  dispose(): void {
    this.init = null;
  }

  getInitialization(): DetectorInitialization | null {
    return this.init;
  }
}

const source = {} as CanvasImageSource;

describe('edge mobility pipeline', () => {
  it('turns rider detections into one confirmed cyclist crossing event', async () => {
    // The synthetic trajectory deliberately stays within the tracker's initial
    // spatial gate before velocity has been estimated, then crosses x=0.5.
    const detector = new MockDetector([
      riderFrame(420),
      riderFrame(470),
      riderFrame(530),
    ]);
    const pipeline = new EdgeMobilityPipeline(detector, {
      sessionId: 'session_test',
      countingLines: [{
        id: 'main_line',
        a: { x: 0.5, y: 0.1 },
        b: { x: 0.5, y: 0.9 },
      }],
      counting: {
        deadzoneRelativeToFrameHeight: 0.002,
        pendingConfirmationMs: 1000,
      },
    });
    await pipeline.initialize();

    const frames = [];
    for (let index = 0; index < 3; index += 1) {
      frames.push(await pipeline.process({
        source,
        sourceWidth: 1000,
        sourceHeight: 500,
        timestampMs: 1000 + index * 200,
      }));
    }

    expect(frames[0]?.fusion.entities).toHaveLength(1);
    expect(frames[0]?.fusion.entities[0]?.entityType).toBe('cyclist');
    expect(frames[0]?.crossings).toHaveLength(0);
    expect(frames[1]?.crossings).toHaveLength(0);
    expect(frames[2]?.tracking.confirmedTracks).toHaveLength(1);
    expect(frames[2]?.crossings).toHaveLength(1);
    expect(frames[2]?.crossings[0]?.entityType).toBe('cyclist');
    expect(frames[2]?.crossings[0]?.crossingPoint.x).toBeCloseTo(0.5, 6);
    expect(frames[2]?.crossings[0]?.crossingPointSpace).toBe('normalized_image');
  });
});
