import { describe, expect, it } from 'vitest';
import {
  addAnnotationFrame,
  addGroundTruthObject,
  createAnnotationDraft,
  removeGroundTruthObject,
  restoreAnnotationDraft,
  serializeAnnotationDraft,
  toAnnotatedBenchmarkSequence,
} from '../../src/detection/annotationDraft';

describe('benchmark annotation draft', () => {
  it('sorts frames by media time even when annotation occurs out of order', () => {
    const draft = createAnnotationDraft('pilot', 'street-a');
    addAnnotationFrame(draft, { mediaTimeMs: 2_000, width: 1920, height: 1080 });
    addAnnotationFrame(draft, { mediaTimeMs: 500, width: 1920, height: 1080 });
    const sequence = toAnnotatedBenchmarkSequence(draft);
    expect(sequence.frames.map((frame) => frame.mediaTimeMs)).toEqual([500, 2_000]);
    expect(sequence.frames.map((frame) => frame.timestampMs)).toEqual([500, 2_000]);
  });

  it('deduplicates an exact media time rather than creating two evaluation frames', () => {
    const draft = createAnnotationDraft('pilot', 'street-a');
    const first = addAnnotationFrame(draft, { mediaTimeMs: 1_000, width: 1280, height: 720 });
    const second = addAnnotationFrame(draft, { mediaTimeMs: 1_000, width: 1280, height: 720 });
    expect(second).toBe(first);
    expect(draft.frames).toHaveLength(1);
  });

  it('creates valid class, occlusion and ignore ground truth objects', () => {
    const draft = createAnnotationDraft('pilot', 'street-a');
    const frame = addAnnotationFrame(draft, { mediaTimeMs: 1_000, width: 1280, height: 720 });
    const object = addGroundTruthObject(draft, frame.frameId, {
      className: 'bicycle',
      bbox: { x: 100, y: 200, width: 80, height: 90 },
      occlusion: 'partial',
      ignore: false,
    });
    expect(object.annotationId).toBe('annotation-0001');
    expect(object.occlusion).toBe('partial');
    expect(toAnnotatedBenchmarkSequence(draft).frames[0]?.objects).toHaveLength(1);
  });

  it('rejects a box completely outside the source frame', () => {
    const draft = createAnnotationDraft('pilot', 'street-a');
    const frame = addAnnotationFrame(draft, { mediaTimeMs: 1_000, width: 640, height: 360 });
    expect(() => addGroundTruthObject(draft, frame.frameId, {
      className: 'car',
      bbox: { x: 700, y: 20, width: 100, height: 50 },
    })).toThrow('does not intersect the frame');
  });

  it('removes an object without reusing its annotation id', () => {
    const draft = createAnnotationDraft('pilot', 'street-a');
    const frame = addAnnotationFrame(draft, { mediaTimeMs: 1_000, width: 640, height: 360 });
    const first = addGroundTruthObject(draft, frame.frameId, {
      className: 'person', bbox: { x: 1, y: 1, width: 20, height: 50 },
    });
    expect(removeGroundTruthObject(draft, frame.frameId, first.annotationId)).toBe(true);
    const second = addGroundTruthObject(draft, frame.frameId, {
      className: 'person', bbox: { x: 2, y: 2, width: 20, height: 50 },
    });
    expect(second.annotationId).toBe('annotation-0002');
  });

  it('round-trips through the benchmark JSON parser shape and continues generated ids', () => {
    const draft = createAnnotationDraft('pilot', 'street-a');
    const frame = addAnnotationFrame(draft, { mediaTimeMs: 1_000, width: 640, height: 360 });
    addGroundTruthObject(draft, frame.frameId, {
      className: 'bus', bbox: { x: 20, y: 30, width: 200, height: 140 },
    });
    const serialized = serializeAnnotationDraft(draft);
    const restored = restoreAnnotationDraft(JSON.parse(serialized));
    const nextFrame = addAnnotationFrame(restored, { mediaTimeMs: 2_000, width: 640, height: 360 });
    const nextObject = addGroundTruthObject(restored, nextFrame.frameId, {
      className: 'truck', bbox: { x: 40, y: 50, width: 180, height: 120 },
    });
    expect(nextFrame.frameId).toBe('frame-0002');
    expect(nextObject.annotationId).toBe('annotation-0002');
  });
});
