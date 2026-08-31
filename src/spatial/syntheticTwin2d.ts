import { ANONYMOUS_AVATAR_PROFILES } from './anonymousAvatar';
import type { AnonymousRenderEntity, MetricPoint2D } from './types';

export interface SyntheticTwinViewport {
  center: MetricPoint2D;
  pixelsPerMeter: number;
  rotationDegrees?: number;
  invertY?: boolean;
}

export interface SyntheticTwinRenderOptions {
  clear?: boolean;
  showHeading?: boolean;
  showSpeed?: boolean;
  showTrackIds?: boolean;
  background?: string;
  foreground?: string;
  lowQualityThreshold?: number;
}

export interface CanvasPoint {
  x: number;
  y: number;
}

export function metricToCanvas(
  point: MetricPoint2D,
  viewport: SyntheticTwinViewport,
  canvasWidth: number,
  canvasHeight: number,
): CanvasPoint {
  if (!(viewport.pixelsPerMeter > 0)) {
    throw new Error('pixelsPerMeter must be greater than zero');
  }

  const dx = point.xMeters - viewport.center.xMeters;
  const rawDy = point.yMeters - viewport.center.yMeters;
  const dy = viewport.invertY === false ? rawDy : -rawDy;
  const angle = ((viewport.rotationDegrees ?? 0) * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const rx = dx * cos - dy * sin;
  const ry = dx * sin + dy * cos;

  return {
    x: canvasWidth / 2 + rx * viewport.pixelsPerMeter,
    y: canvasHeight / 2 + ry * viewport.pixelsPerMeter,
  };
}

function avatarAngleRadians(entity: AnonymousRenderEntity, viewport: SyntheticTwinViewport): number {
  const heading = entity.headingDegrees ?? 0;
  const rotation = viewport.rotationDegrees ?? 0;
  // Heading is defined clockwise from north; Canvas rotation is clockwise from +x.
  return ((heading + rotation - 90) * Math.PI) / 180;
}

function drawHeadingVector(
  context: CanvasRenderingContext2D,
  lengthPx: number,
): void {
  context.beginPath();
  context.moveTo(0, 0);
  context.lineTo(lengthPx, 0);
  context.stroke();
}

function drawAvatarShape(
  context: CanvasRenderingContext2D,
  entity: AnonymousRenderEntity,
  pixelsPerMeter: number,
): void {
  const profile = ANONYMOUS_AVATAR_PROFILES[entity.entityType];
  const length = Math.max(5, profile.lengthMeters * pixelsPerMeter);
  const width = Math.max(5, profile.widthMeters * pixelsPerMeter);

  if (entity.shape === 'capsule') {
    context.beginPath();
    context.ellipse(0, 0, width / 2, width / 2, 0, 0, Math.PI * 2);
    context.fill();
    return;
  }

  if (entity.shape === 'cycle') {
    const wheelRadius = Math.max(2, width * 0.28);
    context.beginPath();
    context.arc(-length * 0.28, 0, wheelRadius, 0, Math.PI * 2);
    context.arc(length * 0.28, 0, wheelRadius, 0, Math.PI * 2);
    context.stroke();
    context.beginPath();
    context.moveTo(-length * 0.28, 0);
    context.lineTo(0, -width * 0.35);
    context.lineTo(length * 0.28, 0);
    context.lineTo(-length * 0.28, 0);
    context.stroke();
    return;
  }

  context.beginPath();
  context.rect(-length / 2, -width / 2, length, width);
  context.fill();
}

/**
 * Privacy-preserving renderer. It accepts only AnonymousRenderEntity records;
 * no video, image frame, crop, face, plate or appearance information exists in
 * its public contract.
 */
export function renderSyntheticTwin2D(
  context: CanvasRenderingContext2D,
  entities: readonly AnonymousRenderEntity[],
  viewport: SyntheticTwinViewport,
  options: SyntheticTwinRenderOptions = {},
): void {
  const canvas = context.canvas;
  const foreground = options.foreground ?? '#1e293b';
  const background = options.background ?? '#f8fafc';
  const lowQualityThreshold = options.lowQualityThreshold ?? 0.55;

  if (options.clear !== false) {
    context.save();
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.restore();
  }

  for (const entity of entities) {
    const point = metricToCanvas(entity.position, viewport, canvas.width, canvas.height);
    context.save();
    context.translate(point.x, point.y);
    context.rotate(avatarAngleRadians(entity, viewport));
    context.globalAlpha = entity.opacity;
    context.fillStyle = foreground;
    context.strokeStyle = foreground;
    context.lineWidth = 2;

    if (entity.confidence < lowQualityThreshold) {
      context.setLineDash([4, 4]);
      context.globalAlpha *= 0.55;
    }

    drawAvatarShape(context, entity, viewport.pixelsPerMeter);

    if (options.showHeading === true && entity.headingDegrees !== undefined) {
      drawHeadingVector(context, Math.max(12, viewport.pixelsPerMeter * 1.5));
    }

    context.restore();

    if (options.showSpeed === true && entity.speedMps !== undefined) {
      context.save();
      context.fillStyle = foreground;
      context.globalAlpha = Math.max(0.45, entity.opacity);
      context.font = '12px sans-serif';
      context.fillText(`${(entity.speedMps * 3.6).toFixed(1)} km/h`, point.x + 7, point.y - 7);
      context.restore();
    }

    if (options.showTrackIds === true) {
      context.save();
      context.fillStyle = foreground;
      context.globalAlpha = 0.6;
      context.font = '10px monospace';
      context.fillText(entity.renderTrackId, point.x + 7, point.y + 12);
      context.restore();
    }
  }
}
