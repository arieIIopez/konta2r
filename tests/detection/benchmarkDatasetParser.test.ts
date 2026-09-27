import { describe, expect, it } from 'vitest';
import { parseAnnotatedBenchmarkSequenceJson } from '../../src/detection/benchmarkDatasetParser';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function validSequence(): Record<string, unknown> {
  return {
    schemaVersion: '1',
    datasetId: 'local-corpus',
    sequenceId: 'seq-1',
    source: {
      annotationSha256: HASH_A,
      mediaSha256: HASH_B,
      note: 'external manifest values',
    },
    frames: [{
      frameId: 'f1',
      timestampMs: 1000,
      mediaTimeMs: 500,
      width: 640,
      height: 360,
      objects: [{
        annotationId: 'p1',
        className: 'person',
        bbox: { x: 10, y: 20, width: 30, height: 80 },
        occlusion: 'partial',
        ignore: false,
      }],
    }],
  };
}

describe('benchmark dataset JSON parser', () => {
  it('parses valid local annotations and then applies semantic sequence validation', () => {
    const sequence = parseAnnotatedBenchmarkSequenceJson(JSON.stringify(validSequence()));
    expect(sequence.datasetId).toBe('local-corpus');
    expect(sequence.frames[0]?.mediaTimeMs).toBe(500);
    expect(sequence.frames[0]?.objects[0]).toMatchObject({
      annotationId: 'p1',
      className: 'person',
      occlusion: 'partial',
      ignore: false,
    });
    expect(sequence.source?.annotationSha256).toBe(HASH_A);
  });

  it('rejects malformed JSON before constructing a sequence', () => {
    expect(() => parseAnnotatedBenchmarkSequenceJson('{bad json'))
      .toThrow('not valid JSON');
  });

  it('rejects invalid nested bbox values rather than casting them', () => {
    const value = validSequence() as any;
    value.frames[0].objects[0].bbox.width = '30';
    expect(() => parseAnnotatedBenchmarkSequenceJson(JSON.stringify(value)))
      .toThrow('bbox.width must be a finite number');
  });

  it('rejects unsupported occlusion labels', () => {
    const value = validSequence() as any;
    value.frames[0].objects[0].occlusion = 'mostly';
    expect(() => parseAnnotatedBenchmarkSequenceJson(JSON.stringify(value)))
      .toThrow('must be none, partial or heavy');
  });

  it('rejects invalid source hashes instead of silently accepting manifest claims', () => {
    const value = validSequence() as any;
    value.source.mediaSha256 = 'not-a-hash';
    expect(() => parseAnnotatedBenchmarkSequenceJson(JSON.stringify(value)))
      .toThrow('must be a SHA-256 hex digest');
  });

  it('still rejects duplicate frame ids through the shared semantic validator', () => {
    const value = validSequence() as any;
    value.frames.push({ ...value.frames[0] });
    expect(() => parseAnnotatedBenchmarkSequenceJson(JSON.stringify(value)))
      .toThrow('Duplicate frameId');
  });
});
