import { solveMinimumCostAssignment } from './hungarian';

export interface GroundTruthObject {
  id: string;
}

export interface IdentityMatch {
  groundTruthId: string;
  trackId: string;
}

export interface TrackingEvaluationFrame {
  groundTruth: GroundTruthObject[];
  matches: IdentityMatch[];
  /** Predicted tracks visible in the frame that do not correspond to GT. */
  unmatchedPredictedTrackIds?: string[];
}

export interface TrackingIdentityMetrics {
  groundTruthDetections: number;
  predictedDetections: number;
  idTruePositives: number;
  idFalsePositives: number;
  idFalseNegatives: number;
  idPrecision: number;
  idRecall: number;
  idF1: number;
  idSwitches: number;
  fragmentations: number;
  uniqueGroundTruthObjects: number;
  uniquePredictedTracks: number;
  uniqueCountError: number;
  uniqueCountAbsoluteError: number;
}

function safeDivide(numerator: number, denominator: number): number {
  return denominator <= 0 ? 0 : numerator / denominator;
}

/**
 * Computes identity-centric metrics from already spatially matched GT/prediction
 * pairs. Spatial matching to construct `matches` is intentionally separate so
 * evaluation thresholds remain explicit in validation tooling.
 */
export function evaluateTrackingIdentity(
  frames: readonly TrackingEvaluationFrame[],
): TrackingIdentityMetrics {
  const gtIds = new Set<string>();
  const predictedIds = new Set<string>();
  let groundTruthDetections = 0;
  let predictedDetections = 0;
  let idSwitches = 0;
  let fragmentations = 0;

  const pairCounts = new Map<string, number>();
  const lastTrackForGt = new Map<string, string>();
  const seenMatched = new Set<string>();
  const wasMatchedPreviousFrame = new Map<string, boolean>();
  const hadGapAfterMatch = new Set<string>();

  for (const frame of frames) {
    const gtInFrame = new Set(frame.groundTruth.map((item) => item.id));
    groundTruthDetections += gtInFrame.size;
    for (const id of gtInFrame) gtIds.add(id);

    const matchByGt = new Map<string, string>();
    for (const match of frame.matches) {
      if (!gtInFrame.has(match.groundTruthId)) {
        throw new Error(`Match references missing ground truth object: ${match.groundTruthId}`);
      }
      if (matchByGt.has(match.groundTruthId)) {
        throw new Error(`Ground truth object matched more than once in a frame: ${match.groundTruthId}`);
      }
      matchByGt.set(match.groundTruthId, match.trackId);
      predictedIds.add(match.trackId);
      predictedDetections += 1;

      const pairKey = `${match.groundTruthId}\u0000${match.trackId}`;
      pairCounts.set(pairKey, (pairCounts.get(pairKey) ?? 0) + 1);

      const previousTrack = lastTrackForGt.get(match.groundTruthId);
      if (previousTrack !== undefined && previousTrack !== match.trackId) {
        idSwitches += 1;
      }
      lastTrackForGt.set(match.groundTruthId, match.trackId);

      if (hadGapAfterMatch.has(match.groundTruthId)) {
        fragmentations += 1;
        hadGapAfterMatch.delete(match.groundTruthId);
      }
      seenMatched.add(match.groundTruthId);
    }

    for (const trackId of frame.unmatchedPredictedTrackIds ?? []) {
      predictedIds.add(trackId);
      predictedDetections += 1;
    }

    for (const gtId of gtInFrame) {
      const matchedNow = matchByGt.has(gtId);
      const matchedBefore = seenMatched.has(gtId);
      const matchedPrevious = wasMatchedPreviousFrame.get(gtId) ?? false;
      if (!matchedNow && matchedBefore && matchedPrevious) {
        hadGapAfterMatch.add(gtId);
      }
      wasMatchedPreviousFrame.set(gtId, matchedNow);
    }
  }

  const gtList = [...gtIds];
  const predList = [...predictedIds];
  let idTruePositives = 0;

  if (gtList.length > 0 && predList.length > 0) {
    let maxPairCount = 0;
    const counts = gtList.map((gtId) => predList.map((trackId) => {
      const value = pairCounts.get(`${gtId}\u0000${trackId}`) ?? 0;
      maxPairCount = Math.max(maxPairCount, value);
      return value;
    }));
    const costs = counts.map((row) => row.map((value) => maxPairCount - value));
    const assignment = solveMinimumCostAssignment(costs);
    for (const item of assignment) {
      idTruePositives += counts[item.row]?.[item.column] ?? 0;
    }
  }

  const idFalseNegatives = Math.max(0, groundTruthDetections - idTruePositives);
  const idFalsePositives = Math.max(0, predictedDetections - idTruePositives);
  const idPrecision = safeDivide(idTruePositives, idTruePositives + idFalsePositives);
  const idRecall = safeDivide(idTruePositives, idTruePositives + idFalseNegatives);
  const idF1 = safeDivide(2 * idPrecision * idRecall, idPrecision + idRecall);
  const uniqueCountError = predictedIds.size - gtIds.size;

  return {
    groundTruthDetections,
    predictedDetections,
    idTruePositives,
    idFalsePositives,
    idFalseNegatives,
    idPrecision,
    idRecall,
    idF1,
    idSwitches,
    fragmentations,
    uniqueGroundTruthObjects: gtIds.size,
    uniquePredictedTracks: predictedIds.size,
    uniqueCountError,
    uniqueCountAbsoluteError: Math.abs(uniqueCountError),
  };
}
