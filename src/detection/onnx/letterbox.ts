import type { BoundingBox, Point2D } from '../../core/types';

export interface LetterboxTransform {
  sourceWidth: number;
  sourceHeight: number;
  inputWidth: number;
  inputHeight: number;
  scale: number;
  resizedWidth: number;
  resizedHeight: number;
  padX: number;
  padY: number;
}

function assertPositiveDimension(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be finite and greater than zero`);
  }
}

export function calculateLetterboxTransform(
  sourceWidth: number,
  sourceHeight: number,
  inputWidth: number,
  inputHeight: number,
): LetterboxTransform {
  assertPositiveDimension(sourceWidth, 'sourceWidth');
  assertPositiveDimension(sourceHeight, 'sourceHeight');
  assertPositiveDimension(inputWidth, 'inputWidth');
  assertPositiveDimension(inputHeight, 'inputHeight');

  const scale = Math.min(inputWidth / sourceWidth, inputHeight / sourceHeight);
  const resizedWidth = sourceWidth * scale;
  const resizedHeight = sourceHeight * scale;

  return {
    sourceWidth,
    sourceHeight,
    inputWidth,
    inputHeight,
    scale,
    resizedWidth,
    resizedHeight,
    padX: (inputWidth - resizedWidth) / 2,
    padY: (inputHeight - resizedHeight) / 2,
  };
}

export function sourcePointToModel(
  point: Point2D,
  transform: LetterboxTransform,
): Point2D {
  return {
    x: point.x * transform.scale + transform.padX,
    y: point.y * transform.scale + transform.padY,
  };
}

export function modelPointToSource(
  point: Point2D,
  transform: LetterboxTransform,
): Point2D {
  return {
    x: (point.x - transform.padX) / transform.scale,
    y: (point.y - transform.padY) / transform.scale,
  };
}

export function sourceBoxToModel(
  box: BoundingBox,
  transform: LetterboxTransform,
): BoundingBox {
  const topLeft = sourcePointToModel({ x: box.x, y: box.y }, transform);
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: box.width * transform.scale,
    height: box.height * transform.scale,
  };
}

export function modelBoxToSource(
  box: BoundingBox,
  transform: LetterboxTransform,
): BoundingBox {
  const topLeft = modelPointToSource({ x: box.x, y: box.y }, transform);
  return clampBoxToSource({
    x: topLeft.x,
    y: topLeft.y,
    width: box.width / transform.scale,
    height: box.height / transform.scale,
  }, transform.sourceWidth, transform.sourceHeight);
}

export function clampBoxToSource(
  box: BoundingBox,
  sourceWidth: number,
  sourceHeight: number,
): BoundingBox {
  assertPositiveDimension(sourceWidth, 'sourceWidth');
  assertPositiveDimension(sourceHeight, 'sourceHeight');

  const left = Math.min(sourceWidth, Math.max(0, box.x));
  const top = Math.min(sourceHeight, Math.max(0, box.y));
  const right = Math.min(sourceWidth, Math.max(left, box.x + box.width));
  const bottom = Math.min(sourceHeight, Math.max(top, box.y + box.height));

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}
