import {
  PUBLIC_LIFE_PREDICATES,
  type PublicLifePredicateSpec,
} from './vocabulary';
import {
  validatePublicLifeGroundTruthSequence,
  type PublicLifeGroundTruthEpisode,
  type PublicLifeGroundTruthSequence,
  type PublicLifeRelationJudgment,
} from './groundTruth';

export type PublicLifeBenchmarkVariant =
  | 'A_geometry'
  | 'B_relation_provider'
  | 'C_hybrid'
  | 'D_hybrid_temporal'
  | string;

export interface PublicLifePredictedRelation {
  frameId: string;
  subjectId: string;
  objectId: string;
  predicateId: string;
  score: number;
}

export interface PublicLifePredictedEpisode {
  subjectId: string;
  objectId: string;
  predicateId: string;
  startMs: number;
  endMs: number;
  score?: number;
}

export interface PublicLifeBenchmarkThresholds {
  defaultScore: number;
  byPredicate?: Record<string, number>;
  episodeMinTemporalIou: number;
}

export interface PublicLifePredicateFrameMetrics {
  predicateId: string;
  truePositive: number;
  trueNegative: number;
  falsePositive: number;
  falseNegative: number;
  scoredJudgments: number;
  uncertainJudgments: number;
  notObservableJudgments: number;
  unscoredPredictions: number;
  precision: number;
  recall: number;
  specificity: number;
  f1: number;
  accuracy: number;
}

export interface PublicLifeFrameBenchmark {
  predicates: PublicLifePredicateFrameMetrics[];
  macroF1: number;
  macroPrecision: number;
  macroRecall: number;
  scoredJudgments: number;
  unscoredPredictions: number;
}

export interface PublicLifeEpisodeMatch {
  predicateId: string;
  subjectId: string;
  objectId: string;
  groundTruthEpisodeId: string;
  groundTruthStartMs: number;
  groundTruthEndMs: number;
  predictedStartMs: number;
  predictedEndMs: number;
  temporalIou: number;
  startErrorMs: number;
  endErrorMs: number;
  durationErrorMs: number;
}

export interface PublicLifeEpisodeBenchmark {
  positiveGroundTruthEpisodes: number;
  uncertainGroundTruthEpisodes: number;
  predictedEpisodes: number;
  matchedPositiveEpisodes: number;
  missedPositiveEpisodes: number;
  positiveEpisodeRecall: number;
  unverifiedPredictedEpisodes: number;
  fragmentationExcess: number;
  meanTemporalIou: number;
  startMaeMs: number;
  endMaeMs: number;
  durationMaeMs: number;
  matches: PublicLifeEpisodeMatch[];
}

export interface PublicLifeBenchmarkResult {
  variant: PublicLifeBenchmarkVariant;
  sequenceId: string;
  thresholds: PublicLifeBenchmarkThresholds;
  frame: PublicLifeFrameBenchmark;
  episodes: PublicLifeEpisodeBenchmark;
}

const DEFAULT_THRESHOLDS: PublicLifeBenchmarkThresholds = {
  defaultScore: 0.5,
  episodeMinTemporalIou: 0.3,
};

function safeDivide(numerator: number, denominator: number): number {
  return denominator <= 0 ? 0 : numerator / denominator;
}

function mean(values: readonly number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clampThreshold(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be within [0, 1]`);
  }
  return value;
}

function validatedThresholds(
  overrides: Partial<PublicLifeBenchmarkThresholds> = {},
): PublicLifeBenchmarkThresholds {
  const thresholds: PublicLifeBenchmarkThresholds = {
    ...DEFAULT_THRESHOLDS,
    ...overrides,
    ...(overrides.byPredicate === undefined
      ? {}
      : { byPredicate: { ...overrides.byPredicate } }),
  };
  clampThreshold(thresholds.defaultScore, 'defaultScore');
  clampThreshold(thresholds.episodeMinTemporalIou, 'episodeMinTemporalIou');
  for (const [predicateId, threshold] of Object.entries(thresholds.byPredicate ?? {})) {
    clampThreshold(threshold, `threshold for ${predicateId}`);
  }
  return thresholds;
}

function predicateIndex(
  predicates: readonly PublicLifePredicateSpec[] = PUBLIC_LIFE_PREDICATES,
): Map<string, PublicLifePredicateSpec> {
  return new Map(predicates.map((predicate) => [predicate.id, predicate]));
}

function canonicalEndpoints(
  subjectId: string,
  objectId: string,
  symmetric: boolean,
): [string, string] {
  if (!symmetric || subjectId.localeCompare(objectId) <= 0) {
    return [subjectId, objectId];
  }
  return [objectId, subjectId];
}

function relationKey(
  frameId: string,
  subjectId: string,
  objectId: string,
  predicateId: string,
  symmetric: boolean,
): string {
  const [subject, object] = canonicalEndpoints(subjectId, objectId, symmetric);
  return JSON.stringify([frameId, subject, predicateId, object]);
}

function episodeRelationKey(
  subjectId: string,
  objectId: string,
  predicateId: string,
  symmetric: boolean,
): string {
  const [subject, object] = canonicalEndpoints(subjectId, objectId, symmetric);
  return JSON.stringify([subject, predicateId, object]);
}

function relationThreshold(
  predicateId: string,
  thresholds: PublicLifeBenchmarkThresholds,
): number {
  return thresholds.byPredicate?.[predicateId] ?? thresholds.defaultScore;
}

function emptyFrameMetrics(predicateId: string): PublicLifePredicateFrameMetrics {
  return {
    predicateId,
    truePositive: 0,
    trueNegative: 0,
    falsePositive: 0,
    falseNegative: 0,
    scoredJudgments: 0,
    uncertainJudgments: 0,
    notObservableJudgments: 0,
    unscoredPredictions: 0,
    precision: 0,
    recall: 0,
    specificity: 0,
    f1: 0,
    accuracy: 0,
  };
}

function finalizeFrameMetrics(
  metrics: PublicLifePredicateFrameMetrics,
): PublicLifePredicateFrameMetrics {
  const precision = safeDivide(
    metrics.truePositive,
    metrics.truePositive + metrics.falsePositive,
  );
  const recall = safeDivide(
    metrics.truePositive,
    metrics.truePositive + metrics.falseNegative,
  );
  const specificity = safeDivide(
    metrics.trueNegative,
    metrics.trueNegative + metrics.falsePositive,
  );
  const f1 = safeDivide(2 * precision * recall, precision + recall);
  const accuracy = safeDivide(
    metrics.truePositive + metrics.trueNegative,
    metrics.scoredJudgments,
  );
  return {
    ...metrics,
    precision,
    recall,
    specificity,
    f1,
    accuracy,
  };
}

function judgmentScoreKey(
  frameId: string,
  judgment: PublicLifeRelationJudgment,
  predicates: Map<string, PublicLifePredicateSpec>,
): string {
  const predicate = predicates.get(judgment.predicateId);
  return relationKey(
    frameId,
    judgment.subjectId,
    judgment.objectId,
    judgment.predicateId,
    predicate?.symmetric ?? false,
  );
}

export function evaluatePublicLifeFrames(
  groundTruth: PublicLifeGroundTruthSequence,
  predictions: readonly PublicLifePredictedRelation[],
  thresholdOverrides: Partial<PublicLifeBenchmarkThresholds> = {},
  predicateSpecs: readonly PublicLifePredicateSpec[] = PUBLIC_LIFE_PREDICATES,
): PublicLifeFrameBenchmark {
  validatePublicLifeGroundTruthSequence(groundTruth);
  const thresholds = validatedThresholds(thresholdOverrides);
  const predicates = predicateIndex(predicateSpecs);
  const frameIds = new Set(groundTruth.frames.map((frame) => frame.frameId));
  const targetPredicates = new Set(groundTruth.targetPredicateIds);

  const metrics = new Map(
    groundTruth.targetPredicateIds.map((predicateId) => [
      predicateId,
      emptyFrameMetrics(predicateId),
    ]),
  );

  const judgments = new Map<string, PublicLifeRelationJudgment>();
  for (const frame of groundTruth.frames) {
    for (const judgment of frame.judgments) {
      const key = judgmentScoreKey(frame.frameId, judgment, predicates);
      judgments.set(key, judgment);
      const row = metrics.get(judgment.predicateId);
      if (!row) continue;
      if (judgment.label === 'uncertain') row.uncertainJudgments += 1;
      if (judgment.label === 'not_observable') row.notObservableJudgments += 1;
    }
  }

  const bestPrediction = new Map<string, PublicLifePredictedRelation>();
  for (const prediction of predictions) {
    if (!frameIds.has(prediction.frameId)) {
      throw new Error(`Prediction references unknown frame ${prediction.frameId}`);
    }
    if (!targetPredicates.has(prediction.predicateId)) {
      throw new Error(
        `Prediction uses predicate outside frozen target scope: ${prediction.predicateId}`,
      );
    }
    if (!Number.isFinite(prediction.score) || prediction.score < 0 || prediction.score > 1) {
      throw new Error('Prediction score must be within [0, 1]');
    }
    const predicate = predicates.get(prediction.predicateId);
    const key = relationKey(
      prediction.frameId,
      prediction.subjectId,
      prediction.objectId,
      prediction.predicateId,
      predicate?.symmetric ?? false,
    );
    const previous = bestPrediction.get(key);
    if (!previous || prediction.score > previous.score) {
      bestPrediction.set(key, prediction);
    }
  }

  for (const frame of groundTruth.frames) {
    for (const judgment of frame.judgments) {
      const row = metrics.get(judgment.predicateId);
      if (!row) continue;
      if (judgment.label === 'uncertain' || judgment.label === 'not_observable') {
        continue;
      }

      row.scoredJudgments += 1;
      const key = judgmentScoreKey(frame.frameId, judgment, predicates);
      const prediction = bestPrediction.get(key);
      const predictedPositive = prediction !== undefined
        && prediction.score >= relationThreshold(judgment.predicateId, thresholds);

      if (judgment.label === 'positive') {
        if (predictedPositive) row.truePositive += 1;
        else row.falseNegative += 1;
      } else {
        if (predictedPositive) row.falsePositive += 1;
        else row.trueNegative += 1;
      }
    }
  }

  for (const [key, prediction] of bestPrediction) {
    if (prediction.score < relationThreshold(prediction.predicateId, thresholds)) continue;
    const judgment = judgments.get(key);
    if (judgment?.label === 'positive' || judgment?.label === 'negative') continue;
    const row = metrics.get(prediction.predicateId);
    if (row) row.unscoredPredictions += 1;
  }

  const rows = [...metrics.values()]
    .map(finalizeFrameMetrics)
    .sort((a, b) => a.predicateId.localeCompare(b.predicateId));
  const scoredRows = rows.filter((row) => row.scoredJudgments > 0);

  return {
    predicates: rows,
    macroF1: mean(scoredRows.map((row) => row.f1)),
    macroPrecision: mean(scoredRows.map((row) => row.precision)),
    macroRecall: mean(scoredRows.map((row) => row.recall)),
    scoredJudgments: rows.reduce((sum, row) => sum + row.scoredJudgments, 0),
    unscoredPredictions: rows.reduce((sum, row) => sum + row.unscoredPredictions, 0),
  };
}

function temporalIou(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): number {
  const overlap = Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
  const union = Math.max(aEnd, bEnd) - Math.min(aStart, bStart);
  return union <= 0 ? 0 : overlap / union;
}

function validatePredictedEpisode(
  episode: PublicLifePredictedEpisode,
  durationMs: number,
  targetPredicates: ReadonlySet<string>,
): void {
  if (!targetPredicates.has(episode.predicateId)) {
    throw new Error(
      `Predicted episode uses predicate outside frozen target scope: ${episode.predicateId}`,
    );
  }
  if (![episode.startMs, episode.endMs].every(Number.isFinite)) {
    throw new Error('Predicted episode boundaries must be finite');
  }
  if (!(episode.endMs > episode.startMs)) {
    throw new Error('Predicted episode endMs must be greater than startMs');
  }
  if (episode.startMs < 0 || episode.endMs > durationMs) {
    throw new Error('Predicted episode is outside sequence duration');
  }
  if (
    episode.score !== undefined
    && (!Number.isFinite(episode.score) || episode.score < 0 || episode.score > 1)
  ) {
    throw new Error('Predicted episode score must be within [0, 1]');
  }
}

interface EpisodeCandidateMatch {
  gtIndex: number;
  predictionIndex: number;
  temporalIou: number;
}

function positiveEpisodes(
  episodes: readonly PublicLifeGroundTruthEpisode[],
): PublicLifeGroundTruthEpisode[] {
  return episodes.filter((episode) => episode.label === 'positive');
}

export function evaluatePublicLifeEpisodes(
  groundTruth: PublicLifeGroundTruthSequence,
  predictions: readonly PublicLifePredictedEpisode[],
  thresholdOverrides: Partial<PublicLifeBenchmarkThresholds> = {},
  predicateSpecs: readonly PublicLifePredicateSpec[] = PUBLIC_LIFE_PREDICATES,
): PublicLifeEpisodeBenchmark {
  validatePublicLifeGroundTruthSequence(groundTruth);
  const thresholds = validatedThresholds(thresholdOverrides);
  const predicates = predicateIndex(predicateSpecs);
  const targetPredicates = new Set(groundTruth.targetPredicateIds);

  predictions.forEach((episode) =>
    validatePredictedEpisode(episode, groundTruth.durationMs, targetPredicates));

  const positiveGt = positiveEpisodes(groundTruth.episodes);
  const uncertainGt = groundTruth.episodes.filter((episode) => episode.label === 'uncertain');

  const candidateMatches: EpisodeCandidateMatch[] = [];
  positiveGt.forEach((gt, gtIndex) => {
    const spec = predicates.get(gt.predicateId);
    const gtKey = episodeRelationKey(
      gt.subjectId,
      gt.objectId,
      gt.predicateId,
      spec?.symmetric ?? false,
    );
    predictions.forEach((prediction, predictionIndex) => {
      if (prediction.predicateId !== gt.predicateId) return;
      const predictionKey = episodeRelationKey(
        prediction.subjectId,
        prediction.objectId,
        prediction.predicateId,
        spec?.symmetric ?? false,
      );
      if (predictionKey !== gtKey) return;
      const iou = temporalIou(
        gt.startMs,
        gt.endMs,
        prediction.startMs,
        prediction.endMs,
      );
      if (iou >= thresholds.episodeMinTemporalIou) {
        candidateMatches.push({ gtIndex, predictionIndex, temporalIou: iou });
      }
    });
  });

  candidateMatches.sort((a, b) => b.temporalIou - a.temporalIou);
  const usedGt = new Set<number>();
  const usedPredictions = new Set<number>();
  const matches: PublicLifeEpisodeMatch[] = [];

  for (const candidate of candidateMatches) {
    if (usedGt.has(candidate.gtIndex) || usedPredictions.has(candidate.predictionIndex)) {
      continue;
    }
    const gt = positiveGt[candidate.gtIndex];
    const prediction = predictions[candidate.predictionIndex];
    if (!gt || !prediction) continue;

    usedGt.add(candidate.gtIndex);
    usedPredictions.add(candidate.predictionIndex);
    matches.push({
      predicateId: gt.predicateId,
      subjectId: gt.subjectId,
      objectId: gt.objectId,
      groundTruthEpisodeId: gt.episodeId,
      groundTruthStartMs: gt.startMs,
      groundTruthEndMs: gt.endMs,
      predictedStartMs: prediction.startMs,
      predictedEndMs: prediction.endMs,
      temporalIou: candidate.temporalIou,
      startErrorMs: prediction.startMs - gt.startMs,
      endErrorMs: prediction.endMs - gt.endMs,
      durationErrorMs:
        (prediction.endMs - prediction.startMs)
        - (gt.endMs - gt.startMs),
    });
  }

  let fragmentationExcess = 0;
  for (const gt of positiveGt) {
    const spec = predicates.get(gt.predicateId);
    const key = episodeRelationKey(
      gt.subjectId,
      gt.objectId,
      gt.predicateId,
      spec?.symmetric ?? false,
    );
    const overlapping = predictions.filter((prediction) => {
      if (prediction.predicateId !== gt.predicateId) return false;
      const predictionKey = episodeRelationKey(
        prediction.subjectId,
        prediction.objectId,
        prediction.predicateId,
        spec?.symmetric ?? false,
      );
      return predictionKey === key
        && temporalIou(
          gt.startMs,
          gt.endMs,
          prediction.startMs,
          prediction.endMs,
        ) > 0;
    }).length;
    fragmentationExcess += Math.max(0, overlapping - 1);
  }

  return {
    positiveGroundTruthEpisodes: positiveGt.length,
    uncertainGroundTruthEpisodes: uncertainGt.length,
    predictedEpisodes: predictions.length,
    matchedPositiveEpisodes: matches.length,
    missedPositiveEpisodes: positiveGt.length - matches.length,
    positiveEpisodeRecall: safeDivide(matches.length, positiveGt.length),
    // Deliberately not called false positives: the v1 annotation protocol
    // does not define complete negative episode windows.
    unverifiedPredictedEpisodes: predictions.length - usedPredictions.size,
    fragmentationExcess,
    meanTemporalIou: mean(matches.map((match) => match.temporalIou)),
    startMaeMs: mean(matches.map((match) => Math.abs(match.startErrorMs))),
    endMaeMs: mean(matches.map((match) => Math.abs(match.endErrorMs))),
    durationMaeMs: mean(matches.map((match) => Math.abs(match.durationErrorMs))),
    matches,
  };
}

export function evaluatePublicLifeBenchmark(
  variant: PublicLifeBenchmarkVariant,
  groundTruth: PublicLifeGroundTruthSequence,
  framePredictions: readonly PublicLifePredictedRelation[],
  episodePredictions: readonly PublicLifePredictedEpisode[],
  thresholdOverrides: Partial<PublicLifeBenchmarkThresholds> = {},
  predicateSpecs: readonly PublicLifePredicateSpec[] = PUBLIC_LIFE_PREDICATES,
): PublicLifeBenchmarkResult {
  const thresholds = validatedThresholds(thresholdOverrides);
  return {
    variant,
    sequenceId: groundTruth.sequenceId,
    thresholds,
    frame: evaluatePublicLifeFrames(
      groundTruth,
      framePredictions,
      thresholds,
      predicateSpecs,
    ),
    episodes: evaluatePublicLifeEpisodes(
      groundTruth,
      episodePredictions,
      thresholds,
      predicateSpecs,
    ),
  };
}
