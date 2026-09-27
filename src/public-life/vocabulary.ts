export type PublicLifeRelationCategory =
  | 'person_element'
  | 'person_person'
  | 'person_mobility'
  | 'spatial_context';

export type PublicLifePredicateSource =
  | 'relateanything_default'
  | 'experimental_custom';

export type PublicLifePredicateValidationStatus =
  | 'unvalidated'
  | 'benchmark_candidate'
  | 'validated'
  | 'rejected';

export interface PublicLifePredicateSpec {
  id: string;
  phrase: string;
  category: PublicLifeRelationCategory;
  source: PublicLifePredicateSource;
  validationStatus: PublicLifePredicateValidationStatus;
  observableMeaning: string;
  interpretationBoundary: string;
  symmetric: boolean;
}

export const PUBLIC_LIFE_PREDICATES: readonly PublicLifePredicateSpec[] = [
  {
    id: 'sitting_on',
    phrase: 'sitting on',
    category: 'person_element',
    source: 'relateanything_default',
    validationStatus: 'benchmark_candidate',
    observableMeaning: 'A person appears seated on the target element.',
    interpretationBoundary: 'Does not establish comfort, rest, intention or whether the element was designed as seating.',
    symmetric: false,
  },
  {
    id: 'leaning_against',
    phrase: 'leaning against',
    category: 'person_element',
    source: 'relateanything_default',
    validationStatus: 'benchmark_candidate',
    observableMeaning: 'A person appears physically supported by or leaning against the target element.',
    interpretationBoundary: 'Does not establish motive, fatigue or duration without temporal evidence.',
    symmetric: false,
  },
  {
    id: 'standing_beside',
    phrase: 'standing beside',
    category: 'person_element',
    source: 'relateanything_default',
    validationStatus: 'benchmark_candidate',
    observableMeaning: 'A person appears standing beside the target region.',
    interpretationBoundary: 'Proximity alone must not be interpreted as use of the element.',
    symmetric: false,
  },
  {
    id: 'using',
    phrase: 'using',
    category: 'person_element',
    source: 'relateanything_default',
    validationStatus: 'benchmark_candidate',
    observableMeaning: 'The visual relation model reports apparent use of the target object or element.',
    interpretationBoundary: 'This broad predicate requires element-specific validation before becoming an urban indicator.',
    symmetric: false,
  },
  {
    id: 'looking_at',
    phrase: 'looking at',
    category: 'person_element',
    source: 'relateanything_default',
    validationStatus: 'benchmark_candidate',
    observableMeaning: 'A person appears visually oriented toward the target.',
    interpretationBoundary: 'Does not establish attention, interest, comprehension or intention.',
    symmetric: false,
  },
  {
    id: 'talking_to',
    phrase: 'talking to',
    category: 'person_person',
    source: 'relateanything_default',
    validationStatus: 'benchmark_candidate',
    observableMeaning: 'Two person regions present visual evidence compatible with conversation.',
    interpretationBoundary: 'Must be reported as probable observable interaction, not friendship, relationship or intent.',
    symmetric: true,
  },
  {
    id: 'walking_with',
    phrase: 'walking with',
    category: 'person_person',
    source: 'experimental_custom',
    validationStatus: 'unvalidated',
    observableMeaning: 'Two tracked people move together with sustained spatial-temporal compatibility.',
    interpretationBoundary: 'Does not establish that the people know each other or share a destination.',
    symmetric: true,
  },
  {
    id: 'sitting_with',
    phrase: 'sitting with',
    category: 'person_person',
    source: 'experimental_custom',
    validationStatus: 'unvalidated',
    observableMeaning: 'Two people appear seated together for a temporally persistent interval.',
    interpretationBoundary: 'Does not establish a social relationship without additional observable evidence.',
    symmetric: true,
  },
  {
    id: 'riding',
    phrase: 'riding',
    category: 'person_mobility',
    source: 'relateanything_default',
    validationStatus: 'benchmark_candidate',
    observableMeaning: 'A person appears mounted on a bicycle, motorcycle or other rideable object.',
    interpretationBoundary: 'Must be validated separately by rideable class and camera geometry.',
    symmetric: false,
  },
  {
    id: 'holding',
    phrase: 'holding',
    category: 'person_mobility',
    source: 'relateanything_default',
    validationStatus: 'benchmark_candidate',
    observableMeaning: 'A person appears physically holding the target mobility object.',
    interpretationBoundary: 'Holding a bicycle does not by itself establish walking with or parking it.',
    symmetric: false,
  },
  {
    id: 'carrying',
    phrase: 'carrying',
    category: 'person_mobility',
    source: 'relateanything_default',
    validationStatus: 'benchmark_candidate',
    observableMeaning: 'A person appears carrying the target object.',
    interpretationBoundary: 'Requires object-specific validation and does not imply trip purpose.',
    symmetric: false,
  },
  {
    id: 'pushing',
    phrase: 'pushing',
    category: 'person_mobility',
    source: 'experimental_custom',
    validationStatus: 'unvalidated',
    observableMeaning: 'A person appears pushing a bicycle or other mobility object.',
    interpretationBoundary: 'Open-vocabulary availability does not demonstrate that this predicate is measurable without calibration.',
    symmetric: false,
  },
  {
    id: 'walking_beside',
    phrase: 'walking beside',
    category: 'person_mobility',
    source: 'experimental_custom',
    validationStatus: 'unvalidated',
    observableMeaning: 'A person and mobility object move together side by side.',
    interpretationBoundary: 'Must be combined with tracking before interpreting bicycle-walking behavior.',
    symmetric: false,
  },
  {
    id: 'walking_past',
    phrase: 'walking past',
    category: 'spatial_context',
    source: 'relateanything_default',
    validationStatus: 'benchmark_candidate',
    observableMeaning: 'A person appears to pass a target without a stationary-use episode.',
    interpretationBoundary: 'Requires trajectory evidence; a single frame cannot establish passing.',
    symmetric: false,
  },
  {
    id: 'beside',
    phrase: 'beside',
    category: 'spatial_context',
    source: 'relateanything_default',
    validationStatus: 'benchmark_candidate',
    observableMeaning: 'Two regions appear spatially beside one another.',
    interpretationBoundary: 'Pure spatial relation is context, not evidence of interaction or use.',
    symmetric: true,
  },
  {
    id: 'in_front_of',
    phrase: 'in front of',
    category: 'spatial_context',
    source: 'relateanything_default',
    validationStatus: 'benchmark_candidate',
    observableMeaning: 'The subject appears in front of the target in image/scene context.',
    interpretationBoundary: 'Image-space front/back may not equal metric scene depth without calibration.',
    symmetric: false,
  },
];

export function publicLifeVocabulary(
  categories?: readonly PublicLifeRelationCategory[],
): string[] {
  const selected = categories === undefined
    ? PUBLIC_LIFE_PREDICATES
    : PUBLIC_LIFE_PREDICATES.filter((predicate) => categories.includes(predicate.category));
  return selected.map((predicate) => predicate.phrase);
}

export function validatePublicLifeVocabulary(
  predicates: readonly PublicLifePredicateSpec[] = PUBLIC_LIFE_PREDICATES,
): string[] {
  const issues: string[] = [];
  const ids = new Set<string>();
  const phrases = new Set<string>();

  for (const predicate of predicates) {
    if (predicate.id.trim().length === 0) issues.push('predicate id is required');
    if (predicate.phrase.trim().length === 0) issues.push(`predicate ${predicate.id}: phrase is required`);
    if (ids.has(predicate.id)) issues.push(`duplicate predicate id: ${predicate.id}`);
    if (phrases.has(predicate.phrase)) issues.push(`duplicate predicate phrase: ${predicate.phrase}`);
    ids.add(predicate.id);
    phrases.add(predicate.phrase);
  }

  return issues;
}
