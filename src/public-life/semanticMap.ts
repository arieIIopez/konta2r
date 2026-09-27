import type { BoundingBox, Point2D } from '../core/types';

export type PublicSpaceCoordinateSpace =
  | 'image'
  | 'normalized_image'
  | 'local_ground';

export interface SemanticPublicSpaceElement {
  id: string;
  type: string;
  label?: string;
  geometry: {
    space: PublicSpaceCoordinateSpace;
    polygon: Point2D[];
  };
  relationVocabulary?: string[];
}

export interface SemanticPublicSpaceMap {
  mapId: string;
  version: number;
  elements: SemanticPublicSpaceElement[];
}

export interface SemanticMapValidation {
  valid: boolean;
  issues: string[];
}

function finitePoint(point: Point2D): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

export function semanticElementBoundingBox(
  element: SemanticPublicSpaceElement,
): BoundingBox {
  if (element.geometry.polygon.length < 1) {
    throw new Error(`Semantic element ${element.id} has no geometry`);
  }

  const xs = element.geometry.polygon.map((point) => point.x);
  const ys = element.geometry.polygon.map((point) => point.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const right = Math.max(...xs);
  const bottom = Math.max(...ys);

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

export function validateSemanticPublicSpaceMap(
  map: SemanticPublicSpaceMap,
): SemanticMapValidation {
  const issues: string[] = [];

  if (map.mapId.trim().length === 0) issues.push('mapId is required');
  if (!Number.isInteger(map.version) || map.version < 1) {
    issues.push('version must be an integer >= 1');
  }

  const ids = new Set<string>();
  for (const element of map.elements) {
    if (element.id.trim().length === 0) {
      issues.push('element id is required');
      continue;
    }
    if (ids.has(element.id)) issues.push(`duplicate element id: ${element.id}`);
    ids.add(element.id);

    if (element.type.trim().length === 0) {
      issues.push(`element ${element.id}: type is required`);
    }
    if (element.geometry.polygon.length < 3) {
      issues.push(`element ${element.id}: polygon requires at least 3 points`);
      continue;
    }
    if (!element.geometry.polygon.every(finitePoint)) {
      issues.push(`element ${element.id}: polygon contains non-finite coordinates`);
    }

    if (
      element.geometry.space === 'normalized_image'
      && element.geometry.polygon.some(
        (point) => point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1,
      )
    ) {
      issues.push(
        `element ${element.id}: normalized_image coordinates must be within [0, 1]`,
      );
    }
  }

  return { valid: issues.length === 0, issues };
}
