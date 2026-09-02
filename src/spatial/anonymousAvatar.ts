import type { EntityType } from '../core/types';
import type {
  AnonymousAvatarShape,
  AnonymousRenderEntity,
  SpatialTrackSample,
} from './types';

export interface AnonymousAvatarProfile {
  shape: AnonymousAvatarShape;
  lengthMeters: number;
  widthMeters: number;
  heightMeters: number;
}

/**
 * Generic visualization dimensions by mobility category.
 * These values exist only to produce legible abstract avatars. They MUST NOT
 * be treated as measured dimensions of an observed person or vehicle.
 */
export const ANONYMOUS_AVATAR_PROFILES: Record<EntityType, AnonymousAvatarProfile> = {
  pedestrian: { shape: 'capsule', lengthMeters: 0.5, widthMeters: 0.5, heightMeters: 1.7 },
  cyclist: { shape: 'cycle', lengthMeters: 1.8, widthMeters: 0.65, heightMeters: 1.5 },
  skater: { shape: 'small_prism', lengthMeters: 1.0, widthMeters: 0.55, heightMeters: 1.5 },
  motorcyclist: { shape: 'small_prism', lengthMeters: 2.0, widthMeters: 0.8, heightMeters: 1.5 },
  car: { shape: 'car_block', lengthMeters: 4.3, widthMeters: 1.8, heightMeters: 1.5 },
  bus: { shape: 'bus_block', lengthMeters: 11.0, widthMeters: 2.5, heightMeters: 3.1 },
  truck: { shape: 'truck_block', lengthMeters: 8.0, widthMeters: 2.5, heightMeters: 3.2 },
  pet: { shape: 'generic', lengthMeters: 0.8, widthMeters: 0.4, heightMeters: 0.6 },
  unknown: { shape: 'generic', lengthMeters: 1.0, widthMeters: 1.0, heightMeters: 1.0 },
};

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Converts a privacy-preserving spatial sample into the only data structure
 * a 2D/3D avatar renderer should need.
 */
export function toAnonymousRenderEntity(sample: SpatialTrackSample): AnonymousRenderEntity {
  const profile = ANONYMOUS_AVATAR_PROFILES[sample.entityType];
  const quality = Math.min(sample.calibrationQuality, sample.motionQuality, sample.confidence);

  return {
    renderTrackId: sample.renderTrackId,
    entityType: sample.entityType,
    shape: profile.shape,
    position: sample.position,
    ...(sample.headingDegrees === undefined ? {} : { headingDegrees: sample.headingDegrees }),
    ...(sample.speedMps === undefined ? {} : { speedMps: sample.speedMps }),
    confidence: sample.confidence,
    opacity: 0.25 + 0.75 * clamp01(quality),
  };
}
