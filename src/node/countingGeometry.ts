import {
  assertNormalizedPoint,
  validateNormalizedLine,
  type NormalizedDirectedLine,
  type NormalizedPoint2D,
} from '../geometry/normalized';

export const COUNTING_GEOMETRY_SCHEMA_VERSION = '1.0' as const;

export interface CountingGeometryConfiguration {
  schemaVersion: typeof COUNTING_GEOMETRY_SCHEMA_VERSION;
  configurationId: string;
  revision: number;
  updatedAtIso: string;
  referenceFrame: {
    width: number;
    height: number;
    aspectRatio: number;
  };
  line: NormalizedDirectedLine;
  directionConvention: {
    sideA: 'LEFT_OF_A_TO_B';
    sideB: 'RIGHT_OF_A_TO_B';
    publicAToB: 'LEFT_TO_RIGHT';
    publicBToA: 'RIGHT_TO_LEFT';
  };
}

export interface CountingGeometryStore {
  load(): Promise<CountingGeometryConfiguration | undefined>;
  save(configuration: CountingGeometryConfiguration): Promise<void>;
  clear(): Promise<void>;
}

export interface VideoCoverTransform {
  scale: number;
  renderedWidth: number;
  renderedHeight: number;
  offsetX: number;
  offsetY: number;
}

function positiveFinite(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be finite and greater than zero`);
  return value;
}

function safeIso(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error('Counting geometry updatedAtIso must be valid ISO time');
  return new Date(timestamp).toISOString();
}

function cloneLine(line: NormalizedDirectedLine): NormalizedDirectedLine {
  return {
    id: line.id,
    a: { ...line.a },
    b: { ...line.b },
    ...(line.labelLeftToRight === undefined ? {} : { labelLeftToRight: line.labelLeftToRight }),
    ...(line.labelRightToLeft === undefined ? {} : { labelRightToLeft: line.labelRightToLeft }),
  };
}

export function validateCountingGeometryConfiguration(
  configuration: CountingGeometryConfiguration,
): void {
  if (configuration.schemaVersion !== COUNTING_GEOMETRY_SCHEMA_VERSION) {
    throw new Error(`Unsupported counting geometry schema: ${configuration.schemaVersion}`);
  }
  if (!/^geometry_[a-zA-Z0-9_-]{6,}$/.test(configuration.configurationId)) {
    throw new Error('Counting geometry configurationId is invalid');
  }
  if (!Number.isSafeInteger(configuration.revision) || configuration.revision < 1) {
    throw new Error('Counting geometry revision must be a positive integer');
  }
  safeIso(configuration.updatedAtIso);
  const width = positiveFinite(configuration.referenceFrame.width, 'referenceFrame.width');
  const height = positiveFinite(configuration.referenceFrame.height, 'referenceFrame.height');
  const aspectRatio = positiveFinite(configuration.referenceFrame.aspectRatio, 'referenceFrame.aspectRatio');
  const actualAspect = width / height;
  if (Math.abs(actualAspect - aspectRatio) / actualAspect > 0.001) {
    throw new Error('Counting geometry reference aspect ratio is inconsistent');
  }
  validateNormalizedLine(configuration.line);
  if (configuration.line.id.trim().length === 0) throw new Error('Counting geometry line id is required');
  if (Math.hypot(
    configuration.line.b.x - configuration.line.a.x,
    configuration.line.b.y - configuration.line.a.y,
  ) < 0.04) {
    throw new Error('Counting geometry line is too short for reliable touch editing');
  }
  const convention = configuration.directionConvention;
  if (
    convention.sideA !== 'LEFT_OF_A_TO_B'
    || convention.sideB !== 'RIGHT_OF_A_TO_B'
    || convention.publicAToB !== 'LEFT_TO_RIGHT'
    || convention.publicBToA !== 'RIGHT_TO_LEFT'
  ) {
    throw new Error('Counting geometry direction convention is invalid');
  }
}

export function createCountingGeometryConfiguration(input: {
  line: NormalizedDirectedLine;
  frameWidth: number;
  frameHeight: number;
  previous?: CountingGeometryConfiguration;
  nowEpochMs?: number;
  createId?: () => string;
}): CountingGeometryConfiguration {
  const width = positiveFinite(input.frameWidth, 'frameWidth');
  const height = positiveFinite(input.frameHeight, 'frameHeight');
  const now = input.nowEpochMs ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('Invalid counting geometry clock');
  const createId = input.createId ?? (() => {
    const uuid = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
    return `geometry_${uuid.replace(/-/g, '')}`;
  });
  const configuration: CountingGeometryConfiguration = {
    schemaVersion: COUNTING_GEOMETRY_SCHEMA_VERSION,
    configurationId: input.previous?.configurationId ?? createId(),
    revision: (input.previous?.revision ?? 0) + 1,
    updatedAtIso: new Date(now).toISOString(),
    referenceFrame: {
      width,
      height,
      aspectRatio: width / height,
    },
    line: cloneLine(input.line),
    directionConvention: {
      sideA: 'LEFT_OF_A_TO_B',
      sideB: 'RIGHT_OF_A_TO_B',
      publicAToB: 'LEFT_TO_RIGHT',
      publicBToA: 'RIGHT_TO_LEFT',
    },
  };
  validateCountingGeometryConfiguration(configuration);
  return configuration;
}

/** Geometry used by CSS `object-fit: cover`, assuming centered object-position. */
export function videoCoverTransform(
  sourceWidth: number,
  sourceHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): VideoCoverTransform {
  const sw = positiveFinite(sourceWidth, 'sourceWidth');
  const sh = positiveFinite(sourceHeight, 'sourceHeight');
  const vw = positiveFinite(viewportWidth, 'viewportWidth');
  const vh = positiveFinite(viewportHeight, 'viewportHeight');
  const scale = Math.max(vw / sw, vh / sh);
  const renderedWidth = sw * scale;
  const renderedHeight = sh * scale;
  return {
    scale,
    renderedWidth,
    renderedHeight,
    offsetX: (vw - renderedWidth) / 2,
    offsetY: (vh - renderedHeight) / 2,
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Maps a pointer in the visible video element back to the uncropped source frame. */
export function viewportPointToNormalizedVideo(input: {
  x: number;
  y: number;
  sourceWidth: number;
  sourceHeight: number;
  viewportWidth: number;
  viewportHeight: number;
}): NormalizedPoint2D {
  const transform = videoCoverTransform(
    input.sourceWidth,
    input.sourceHeight,
    input.viewportWidth,
    input.viewportHeight,
  );
  const point = {
    x: clamp01((input.x - transform.offsetX) / transform.renderedWidth),
    y: clamp01((input.y - transform.offsetY) / transform.renderedHeight),
  };
  assertNormalizedPoint(point);
  return point;
}

/** Maps normalized source-frame geometry to the visible `cover` viewport. */
export function normalizedVideoPointToViewport(input: {
  point: NormalizedPoint2D;
  sourceWidth: number;
  sourceHeight: number;
  viewportWidth: number;
  viewportHeight: number;
}): { x: number; y: number } {
  assertNormalizedPoint(input.point);
  const transform = videoCoverTransform(
    input.sourceWidth,
    input.sourceHeight,
    input.viewportWidth,
    input.viewportHeight,
  );
  return {
    x: transform.offsetX + input.point.x * transform.renderedWidth,
    y: transform.offsetY + input.point.y * transform.renderedHeight,
  };
}

export function countingLineSideLabels(
  line: NormalizedDirectedLine,
  offset = 0.06,
): { sideA: NormalizedPoint2D; sideB: NormalizedPoint2D } {
  validateNormalizedLine(line);
  const dx = line.b.x - line.a.x;
  const dy = line.b.y - line.a.y;
  const length = Math.hypot(dx, dy);
  const midX = (line.a.x + line.b.x) / 2;
  const midY = (line.a.y + line.b.y) / 2;
  const normalLeft = { x: -dy / length, y: dx / length };
  return {
    sideA: {
      x: clamp01(midX + normalLeft.x * offset),
      y: clamp01(midY + normalLeft.y * offset),
    },
    sideB: {
      x: clamp01(midX - normalLeft.x * offset),
      y: clamp01(midY - normalLeft.y * offset),
    },
  };
}
