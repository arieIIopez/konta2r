import { describe, expect, it } from 'vitest';
import {
  calculateLetterboxTransform,
  modelBoxToSource,
  sourceBoxToModel,
} from '../../../src/detection/onnx/letterbox';

function expectBoxClose(
  actual: { x: number; y: number; width: number; height: number },
  expected: { x: number; y: number; width: number; height: number },
): void {
  expect(actual.x).toBeCloseTo(expected.x, 8);
  expect(actual.y).toBeCloseTo(expected.y, 8);
  expect(actual.width).toBeCloseTo(expected.width, 8);
  expect(actual.height).toBeCloseTo(expected.height, 8);
}

describe('ONNX letterbox geometry', () => {
  it('preserves aspect ratio and centers padding', () => {
    const transform = calculateLetterboxTransform(1280, 720, 640, 640);
    expect(transform.scale).toBe(0.5);
    expect(transform.resizedWidth).toBe(640);
    expect(transform.resizedHeight).toBe(360);
    expect(transform.padX).toBe(0);
    expect(transform.padY).toBe(140);
  });

  it('round-trips a source bounding box through model coordinates', () => {
    const transform = calculateLetterboxTransform(1000, 500, 640, 640);
    const source = { x: 125, y: 80, width: 240, height: 160 };
    const model = sourceBoxToModel(source, transform);
    expectBoxClose(modelBoxToSource(model, transform), source);
  });

  it('clips decoded boxes that extend outside the source image', () => {
    const transform = calculateLetterboxTransform(640, 360, 640, 640);
    const source = modelBoxToSource({ x: -20, y: 120, width: 700, height: 420 }, transform);
    expect(source.x).toBe(0);
    expect(source.y).toBe(0);
    expect(source.width).toBe(640);
    expect(source.height).toBe(360);
  });
});
