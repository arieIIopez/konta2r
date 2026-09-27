import { describe, expect, it } from 'vitest';
import {
  PUBLIC_LIFE_PREDICATES,
  publicLifeVocabulary,
  validatePublicLifeVocabulary,
} from '../../src/public-life/vocabulary';

describe('Public Life vocabulary', () => {
  it('has unique ids and phrases', () => {
    expect(validatePublicLifeVocabulary()).toEqual([]);
  });

  it('distinguishes bundled RelateAnything predicates from open-vocabulary hypotheses', () => {
    const riding = PUBLIC_LIFE_PREDICATES.find((item) => item.id === 'riding');
    const pushing = PUBLIC_LIFE_PREDICATES.find((item) => item.id === 'pushing');

    expect(riding?.source).toBe('relateanything_default');
    expect(riding?.validationStatus).toBe('benchmark_candidate');
    expect(pushing?.source).toBe('experimental_custom');
    expect(pushing?.validationStatus).toBe('unvalidated');
  });

  it('can build a category-scoped provider vocabulary', () => {
    const vocabulary = publicLifeVocabulary(['person_mobility']);

    expect(vocabulary).toContain('riding');
    expect(vocabulary).toContain('walking beside');
    expect(vocabulary).not.toContain('talking to');
  });

  it('keeps all predicates non-validated until evidence is produced', () => {
    expect(
      PUBLIC_LIFE_PREDICATES.some((item) => item.validationStatus === 'validated'),
    ).toBe(false);
  });
});
