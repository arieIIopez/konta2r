import { describe, expect, it } from 'vitest';
import {
  classifyImageScale,
  validateAnnotatedBenchmarkFrame,
  validateAnnotatedBenchmarkSequence,
} from '../../src/detection/benchmarkDataset';

describe('annotated benchmark corpus', () => {
  it('classifies apparent object scale from bbox height relative to frame height', () => {
    expect(classifyImageScale({ x: 0, y: 0, width: 10, height: 19 }, 500)).toBe('tiny');
    expect(classifyImageScale({ x: 0, y: 0, width: 10, height: 20 }, 500)).toBe('small');
    expect(classifyImageScale({ x: 0, y: 0, width: 10, height: 50 }, 500)).toBe('medium');
    expect(classifyImageScale({ x: 0, y: 0, width: 10, height: 125 }, 500)).toBe('large');
  });

  it('rejects duplicate annotation ids within a frame', () => {
    expect(() => validateAnnotatedBenchmarkFrame({
      frameId: 'f1',
      timestampMs: 0,
      width: 640,
      height: 360,
      objects: [
        { annotationId: 'same', className: 'person', bbox: { x: 1, y: 1, width: 20, height: 40 } },
        { annotationId: 'same', className: 'bicycle', bbox: { x: 30, y: 1, width: 30, height: 20 } },
      ],
    })).toThrow('Duplicate annotationId');
  });

  it('rejects sequences whose logical timestamps move backwards', () => {
    expect(() => validateAnnotatedBenchmarkSequence({
      schemaVersion: '1',
      datasetId: 'dataset',
      sequenceId: 'sequence',
      frames: [
        { frameId: 'a', timestampMs: 100, width: 640, height: 360, objects: [] },
        { frameId: 'b', timestampMs: 90, width: 640, height: 360, objects: [] },
      ],
    })).toThrow('non-decreasing');
  });

  it('tracks media seek time independently and rejects backwards seeks', () => {
    expect(() => validateAnnotatedBenchmarkSequence({
      schemaVersion: '1',
      datasetId: 'dataset',
      sequenceId: 'sequence',
      frames: [
        { frameId: 'a', timestampMs: 1000, mediaTimeMs: 500, width: 640, height: 360, objects: [] },
        { frameId: 'b', timestampMs: 1200, mediaTimeMs: 400, width: 640, height: 360, objects: [] },
      ],
    })).toThrow('mediaTimeMs values must be non-decreasing');
  });

  it('rejects negative media seek positions without constraining logical timestamps to media time', () => {
    expect(() => validateAnnotatedBenchmarkFrame({
      frameId: 'f',
      timestampMs: 10_000,
      mediaTimeMs: -1,
      width: 640,
      height: 360,
      objects: [],
    })).toThrow('mediaTimeMs must be finite and non-negative');
  });
});
