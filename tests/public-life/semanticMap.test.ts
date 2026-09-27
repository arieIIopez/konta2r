import { describe, expect, it } from 'vitest';
import {
  semanticElementBoundingBox,
  validateSemanticPublicSpaceMap,
  type SemanticPublicSpaceElement,
} from '../../src/public-life/semanticMap';

const bench: SemanticPublicSpaceElement = {
  id: 'bench_01',
  type: 'bench',
  geometry: {
    space: 'normalized_image',
    polygon: [
      { x: 0.1, y: 0.6 },
      { x: 0.4, y: 0.6 },
      { x: 0.4, y: 0.8 },
      { x: 0.1, y: 0.8 },
    ],
  },
  relationVocabulary: ['sitting on', 'standing beside'],
};

describe('semantic public space map', () => {
  it('validates a versioned normalized map', () => {
    const validation = validateSemanticPublicSpaceMap({
      mapId: 'plaza_01',
      version: 1,
      elements: [bench],
    });

    expect(validation).toEqual({ valid: true, issues: [] });
  });

  it('rejects duplicate ids and out-of-range normalized coordinates', () => {
    const invalid = {
      ...bench,
      geometry: {
        ...bench.geometry,
        polygon: [
          { x: -0.1, y: 0.6 },
          { x: 0.4, y: 0.6 },
          { x: 0.4, y: 0.8 },
        ],
      },
    };

    const validation = validateSemanticPublicSpaceMap({
      mapId: 'plaza_01',
      version: 1,
      elements: [invalid, invalid],
    });

    expect(validation.valid).toBe(false);
    expect(validation.issues.some((issue) => issue.includes('duplicate element id'))).toBe(true);
    expect(
      validation.issues.some((issue) => issue.includes('normalized_image coordinates')),
    ).toBe(true);
  });

  it('derives a bounding box for relation inference from a semantic polygon', () => {
    expect(semanticElementBoundingBox(bench)).toEqual({
      x: 0.1,
      y: 0.6,
      width: 0.30000000000000004,
      height: 0.20000000000000007,
    });
  });
});
