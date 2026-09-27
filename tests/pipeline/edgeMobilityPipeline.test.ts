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
const mainLine = {
  id: 'main_line',
  a: { x: 0.5, y: 0.1 },
  b: { x: 0.5, y: 0.9 },
} as const;

async function processFrame(
  pipeline: EdgeMobilityPipeline,
  timestampMs: number,
) {
  return pipeline.process({
    source,
    sourceWidth: 1000,
    sourceHeight: 500,
    timestampMs,
  });
}

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
      countingLines: [mainLine],
      counting: {
        deadzoneRelativeToFrameHeight: 0.002,
        pendingConfirmationMs: 1000,
      },
    });
    await pipeline.initialize();

    const frames = [];
    for (let index = 0; index < 3; index += 1) {
      frames.push(await processFrame(pipeline, 1000 + index * 200));
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
    await pipeline.dispose();
  });

  it('enables and disables operational counting geometry at runtime', async () => {
    const detector = new MockDetector([
      riderFrame(420),
      riderFrame(470),
      riderFrame(530),
      riderFrame(420),
      riderFrame(470),
      riderFrame(530),
      riderFrame(420),
      riderFrame(470),
      riderFrame(530),
    ]);
    const pipeline = new EdgeMobilityPipeline(detector, {
      sessionId: 'session_dynamic',
      counting: {
        deadzoneRelativeToFrameHeight: 0.002,
        pendingConfirmationMs: 1000,
      },
    });
    await pipeline.initialize();

    const disabledFrames = [
      await processFrame(pipeline, 1000),
      await processFrame(pipeline, 1200),
      await processFrame(pipeline, 1400),
    ];
    expect(disabledFrames.flatMap((frame) => frame.crossings)).toEqual([]);
    expect(pipeline.getCountingLines()).toEqual([]);

    pipeline.setCountingLines([mainLine]);
    expect(pipeline.getCountingLines()).toEqual([mainLine]);
    const enabledFrames = [
      await processFrame(pipeline, 2000),
      await processFrame(pipeline, 2200),
      await processFrame(pipeline, 2400),
    ];
    expect(enabledFrames.flatMap((frame) => frame.crossings)).toHaveLength(1);

    pipeline.setCountingLines([]);
    const disabledAgain = [
      await processFrame(pipeline, 3000),
      await processFrame(pipeline, 3200),
      await processFrame(pipeline, 3400),
    ];
    expect(disabledAgain.flatMap((frame) => frame.crossings)).toEqual([]);
    expect(pipeline.getCountingLines()).toEqual([]);
    await pipeline.dispose();
  });

  it('resets tracker history before a replacement geometry can observe frames', async () => {
    const detector = new MockDetector([
      riderFrame(420),
      riderFrame(470),
      riderFrame(530),
    ]);
    const pipeline = new EdgeMobilityPipeline(detector, {
      sessionId: 'session_replace',
      countingLines: [mainLine],
      counting: {
        deadzoneRelativeToFrameHeight: 0.002,
        pendingConfirmationMs: 1000,
      },
    });
    await pipeline.initialize();

    await processFrame(pipeline, 1000);
    await processFrame(pipeline, 1200);

    const replacement = {
      id: 'replacement_line',
      a: { x: 0.5, y: 0.08 },
      b: { x: 0.5, y: 0.92 },
    } as const;
    pipeline.setCountingLines([replacement]);

    // Without a tracker reset the next point could complete the old trajectory
    // across x=0.5. A clean geometry epoch must instead start with no crossing.
    const firstReplacementFrame = await processFrame(pipeline, 1400);
    expect(firstReplacementFrame.crossings).toEqual([]);
    expect(firstReplacementFrame.tracking.confirmedTracks).toHaveLength(0);
    expect(pipeline.getCountingLines()).toEqual([replacement]);
    await pipeline.dispose();
  });

  it('clones runtime geometry so caller mutation cannot alter the active line', async () => {
    const detector = new MockDetector([riderFrame(420)]);
    const pipeline = new EdgeMobilityPipeline(detector, { sessionId: 'session_clone' });
    await pipeline.initialize();

    const mutableLine = {
      id: 'mutable',
      a: { x: 0.25, y: 0.1 },
      b: { x: 0.25, y: 0.9 },
    };
    pipeline.setCountingLines([mutableLine]);
    mutableLine.a.x = 0.8;

    expect(pipeline.getCountingLines()[0]?.a.x).toBe(0.25);
    const returned = pipeline.getCountingLines();
    if (returned[0]) returned[0].a.x = 0.9;
    expect(pipeline.getCountingLines()[0]?.a.x).toBe(0.25);
    await pipeline.dispose();
  });
});
