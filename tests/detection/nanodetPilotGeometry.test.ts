import { describe, expect, it } from 'vitest';
import type { RawDetection } from '../../src/core/types';
import { NanoDetPilotPipeline } from '../../src/detection/nanodetPilotPipeline';
import type {
  Detector,
  DetectorInitialization,
  DetectorInput,
  DetectorOutput,
} from '../../src/detection/types';
import type { NanoDetPilotLoadResult } from '../../src/detection/onnx/nanodetPilot';

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

class SequenceDetector implements Detector {
  private index = 0;
  private initialization: DetectorInitialization | null = null;

  constructor(private readonly frames: RawDetection[][]) {}

  async initialize(): Promise<DetectorInitialization> {
    this.initialization = {
      model: {
        adapterId: 'nanodet_plus_gfl',
        modelId: 'geometry-test',
        modelVersion: '1',
        weightsRedistributionVerified: false,
        inputWidth: 416,
        inputHeight: 416,
        classNames: ['person', 'bicycle'],
      },
      runtime: {
        runtime: 'onnxruntime-web',
        backend: 'wasm',
        executionProviders: ['wasm'],
      },
    };
    return this.initialization;
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
    this.initialization = null;
  }

  getInitialization(): DetectorInitialization | null {
    return this.initialization;
  }
}

function loaded(detector: Detector): NanoDetPilotLoadResult {
  return {
    detector,
    candidateId: 'geometry-test',
    modelSha256: 'b'.repeat(64),
    artifactSource: 'cache',
    cachePersisted: true,
    redistributionVerified: false,
  };
}

const source = {} as CanvasImageSource;
const line = {
  id: 'line_primary',
  a: { x: 0.5, y: 0.1 },
  b: { x: 0.5, y: 0.9 },
} as const;

async function process(pipeline: NanoDetPilotPipeline, timestampMs: number) {
  return pipeline.process({
    source,
    sourceWidth: 1000,
    sourceHeight: 500,
    timestampMs,
  });
}

describe('NanoDetPilotPipeline counting geometry', () => {
  it('applies geometry set before lazy initialization and resets trajectory state on demand', async () => {
    const detector = new SequenceDetector([
      riderFrame(420),
      riderFrame(470),
      riderFrame(530),
      riderFrame(530),
      riderFrame(420),
      riderFrame(470),
      riderFrame(530),
    ]);
    const pipeline = new NanoDetPilotPipeline({
      sessionId: 'session_geometry_test',
      loader: async () => loaded(detector),
    });

    pipeline.setCountingLines([line]);
    const initial = [
      await process(pipeline, 1000),
      await process(pipeline, 1200),
      await process(pipeline, 1400),
    ];
    expect(initial.flatMap((frame) => frame.crossings)).toHaveLength(1);

    pipeline.resetTrackingAndEvents();
    const firstAfterReset = await process(pipeline, 2000);
    expect(firstAfterReset.crossings).toEqual([]);
    expect(firstAfterReset.tracking.confirmedTracks).toHaveLength(0);

    pipeline.setCountingLines([]);
    const disabled = [
      await process(pipeline, 2400),
      await process(pipeline, 2600),
      await process(pipeline, 2800),
    ];
    expect(disabled.flatMap((frame) => frame.crossings)).toEqual([]);

    await pipeline.dispose();
  });
});
