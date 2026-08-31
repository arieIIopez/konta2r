import type {
  BoundingBox,
  EntityType,
  MobilityEntityObservation,
  Point2D,
  RawDetection,
} from '../core/types';
import { solveMinimumCostAssignment } from '../tracking/hungarian';

export interface ModalFusionConfig {
  minPersonConfidence: number;
  minRideableConfidence: number;
  maxPairCost: number;
  minHorizontalOverlapRatio: number;
  maxNormalizedFootDistance: number;
  motorcycleCanStandAlone: boolean;
  emitPets: boolean;
}

export interface ModalFusionPair {
  personIndex: number;
  rideableIndex: number;
  rideableClass: 'bicycle' | 'motorcycle' | 'skateboard';
  entityType: 'cyclist' | 'motorcyclist' | 'skater';
  cost: number;
  geometryQuality: number;
}

export interface ModalFusionResult {
  entities: MobilityEntityObservation[];
  pairs: ModalFusionPair[];
  suppressedPersonIndices: number[];
  ignoredDetectionIndices: number[];
}

const DEFAULT_CONFIG: ModalFusionConfig = {
  minPersonConfidence: 0.35,
  minRideableConfidence: 0.3,
  maxPairCost: 0.72,
  minHorizontalOverlapRatio: 0.08,
  maxNormalizedFootDistance: 1.35,
  motorcycleCanStandAlone: true,
  emitPets: true,
};

interface IndexedDetection {
  index: number;
  detection: RawDetection;
}

interface RideableCandidate extends IndexedDetection {
  rideableClass: 'bicycle' | 'motorcycle' | 'skateboard';
  entityType: 'cyclist' | 'motorcyclist' | 'skater';
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function normalizedClassName(detection: RawDetection): string {
  return detection.className.trim().toLowerCase();
}

function bottomCenter(box: BoundingBox): Point2D {
  return { x: box.x + box.width / 2, y: box.y + box.height };
}

function center(box: BoundingBox): Point2D {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function diagonal(box: BoundingBox): number {
  return Math.max(1, Math.hypot(box.width, box.height));
}

function horizontalOverlapRatio(a: BoundingBox, b: BoundingBox): number {
  const overlap = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  return overlap / Math.max(1, Math.min(a.width, b.width));
}

function unionBox(a: BoundingBox, b: BoundingBox): BoundingBox {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.width, b.x + b.width);
  const bottom = Math.max(a.y + a.height, b.y + b.height);
  return { x, y, width: right - x, height: bottom - y };
}

function rideableDefinition(className: string): Pick<RideableCandidate, 'rideableClass' | 'entityType'> | null {
  if (className === 'bicycle') return { rideableClass: 'bicycle', entityType: 'cyclist' };
  if (className === 'motorcycle') return { rideableClass: 'motorcycle', entityType: 'motorcyclist' };
  if (className === 'skateboard') return { rideableClass: 'skateboard', entityType: 'skater' };
  return null;
}

function directEntityType(className: string): EntityType | null {
  if (className === 'car') return 'car';
  if (className === 'bus') return 'bus';
  if (className === 'truck') return 'truck';
  if (className === 'dog' || className === 'cat') return 'pet';
  return null;
}

interface PairGeometry {
  cost: number;
  quality: number;
}

/**
 * Geometric rider compatibility. This is intentionally based only on boxes;
 * it does not use appearance, face, clothing or re-identification features.
 */
function riderPairGeometry(
  person: RawDetection,
  rideable: RawDetection,
  config: ModalFusionConfig,
): PairGeometry | null {
  const personFoot = bottomCenter(person.bbox);
  const rideableCenter = center(rideable.bbox);
  const rideableFoot = bottomCenter(rideable.bbox);
  const overlapRatio = horizontalOverlapRatio(person.bbox, rideable.bbox);

  const referenceScale = Math.max(
    diagonal(rideable.bbox),
    person.bbox.height * 0.55,
    20,
  );
  const footDistance = Math.hypot(
    personFoot.x - rideableCenter.x,
    personFoot.y - rideableFoot.y,
  );
  const normalizedFootDistance = footDistance / referenceScale;

  // A rider should not be entirely below the rideable and should have some
  // plausible horizontal/nearby relationship to it.
  const personCenter = center(person.bbox);
  const verticalBelow = Math.max(
    0,
    (personCenter.y - (rideable.bbox.y + rideable.bbox.height * 1.15))
      / Math.max(person.bbox.height, 1),
  );
  const rideableTooHigh = Math.max(
    0,
    (rideable.bbox.y - personFoot.y) / Math.max(rideable.bbox.height, 1),
  );
  const verticalPenalty = clamp01(verticalBelow + rideableTooHigh);

  if (
    overlapRatio < config.minHorizontalOverlapRatio
    && normalizedFootDistance > config.maxNormalizedFootDistance
  ) {
    return null;
  }
  if (verticalPenalty >= 0.95) return null;

  const distanceCost = clamp01(normalizedFootDistance / config.maxNormalizedFootDistance);
  const overlapCost = 1 - clamp01(overlapRatio);
  const cost = 0.55 * distanceCost + 0.3 * overlapCost + 0.15 * verticalPenalty;

  if (cost > config.maxPairCost) return null;
  return { cost, quality: clamp01(1 - cost) };
}

function fusedConfidence(
  personConfidence: number,
  rideableConfidence: number,
  geometryQuality: number,
): number {
  const detectorAgreement = Math.sqrt(clamp01(personConfidence) * clamp01(rideableConfidence));
  return clamp01(detectorAgreement * (0.72 + 0.28 * geometryQuality));
}

function createDirectObservation(
  detection: RawDetection,
  entityType: EntityType,
): MobilityEntityObservation {
  return {
    entityType,
    confidence: detection.confidence,
    groundPoint: bottomCenter(detection.bbox),
    bbox: { ...detection.bbox },
    sourceDetections: [detection],
  };
}

/**
 * Converts raw detector classes into mobility users. A matched person is
 * consumed by the rideable entity, preventing the same cyclist/motorcyclist
 * from also being emitted as a pedestrian in the same frame.
 */
export function fuseModalDetections(
  detections: readonly RawDetection[],
  overrides: Partial<ModalFusionConfig> = {},
): ModalFusionResult {
  const config: ModalFusionConfig = { ...DEFAULT_CONFIG, ...overrides };

  const persons: IndexedDetection[] = [];
  const rideables: RideableCandidate[] = [];
  const direct: IndexedDetection[] = [];
  const ignoredDetectionIndices = new Set<number>();

  detections.forEach((detection, index) => {
    const className = normalizedClassName(detection);
    if (className === 'person') {
      if (detection.confidence >= config.minPersonConfidence) persons.push({ index, detection });
      else ignoredDetectionIndices.add(index);
      return;
    }

    const rideable = rideableDefinition(className);
    if (rideable) {
      if (detection.confidence >= config.minRideableConfidence) {
        rideables.push({ index, detection, ...rideable });
      } else {
        ignoredDetectionIndices.add(index);
      }
      return;
    }

    const entityType = directEntityType(className);
    if (entityType && (entityType !== 'pet' || config.emitPets)) {
      direct.push({ index, detection });
    } else {
      ignoredDetectionIndices.add(index);
    }
  });

  const costMatrix = persons.map(({ detection: person }) => rideables.map(({ detection: rideable }) => {
    const geometry = riderPairGeometry(person, rideable, config);
    return geometry?.cost ?? Number.POSITIVE_INFINITY;
  }));

  const assignments = solveMinimumCostAssignment(costMatrix, config.maxPairCost);
  const pairs: ModalFusionPair[] = [];
  const pairedPersons = new Set<number>();
  const pairedRideables = new Set<number>();
  const entities: MobilityEntityObservation[] = [];

  for (const assignment of assignments) {
    const person = persons[assignment.row];
    const rideable = rideables[assignment.column];
    if (!person || !rideable) continue;
    const geometry = riderPairGeometry(person.detection, rideable.detection, config);
    if (!geometry) continue;

    pairedPersons.add(person.index);
    pairedRideables.add(rideable.index);
    pairs.push({
      personIndex: person.index,
      rideableIndex: rideable.index,
      rideableClass: rideable.rideableClass,
      entityType: rideable.entityType,
      cost: geometry.cost,
      geometryQuality: geometry.quality,
    });

    entities.push({
      entityType: rideable.entityType,
      confidence: fusedConfidence(
        person.detection.confidence,
        rideable.detection.confidence,
        geometry.quality,
      ),
      groundPoint: bottomCenter(rideable.detection.bbox),
      bbox: unionBox(person.detection.bbox, rideable.detection.bbox),
      sourceDetections: [person.detection, rideable.detection],
    });
  }

  // Persons not consumed by a modal pair remain pedestrians.
  for (const person of persons) {
    if (!pairedPersons.has(person.index)) {
      entities.push(createDirectObservation(person.detection, 'pedestrian'));
    }
  }

  // Motorcycles remain a meaningful moving-mode object even when the person
  // detector briefly misses the rider. Unpaired bicycles/skateboards are not
  // promoted here because they may be parked or walked; temporal fusion can
  // later bridge those ambiguous frames.
  for (const rideable of rideables) {
    if (pairedRideables.has(rideable.index)) continue;
    if (rideable.rideableClass === 'motorcycle' && config.motorcycleCanStandAlone) {
      entities.push(createDirectObservation(rideable.detection, 'motorcyclist'));
    } else {
      ignoredDetectionIndices.add(rideable.index);
    }
  }

  for (const item of direct) {
    const entityType = directEntityType(normalizedClassName(item.detection));
    if (entityType) entities.push(createDirectObservation(item.detection, entityType));
  }

  return {
    entities,
    pairs,
    suppressedPersonIndices: [...pairedPersons].sort((a, b) => a - b),
    ignoredDetectionIndices: [...ignoredDetectionIndices].sort((a, b) => a - b),
  };
}

export const MODAL_FUSION_DEFAULTS = { ...DEFAULT_CONFIG };
