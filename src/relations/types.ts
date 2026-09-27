import type { BoundingBox, EntityType } from '../core/types';

export type RelationEndpointKind = 'track' | 'static_element';
export type RelationRuntime = 'onnxruntime-web' | 'rule' | 'other';
export type RelationScoreSemantics = 'dense' | 'thresholded_partial';

export interface RelationEndpoint {
  kind: RelationEndpointKind;
  id: string;
  bbox: BoundingBox;
  entityType?: EntityType;
  elementType?: string;
  confidence?: number;
}

export type RelationCandidateReason =
  | 'spatial_proximity'
  | 'modal_ambiguity'
  | 'configured_pair';

export interface RelationCandidate {
  subject: RelationEndpoint;
  object: RelationEndpoint;
  priority: number;
  reason: RelationCandidateReason;
}

export interface RelationProviderMetadata {
  providerId: string;
  modelId: string;
  modelVersion: string;
  runtime: RelationRuntime;
  /**
   * dense: every requested candidate/predicate pair receives a score.
   * thresholded_partial: omitted outputs are not valid negative evidence.
   */
  scoreSemantics: RelationScoreSemantics;
  backend?: string;
  sourceUrl?: string;
  codeLicense?: string;
  weightsLicense?: string;
  weightsRedistributionVerified: boolean;
}

export interface RelationInput {
  source: CanvasImageSource;
  sourceWidth: number;
  sourceHeight: number;
  timestampMs: number;
  candidates: RelationCandidate[];
  vocabulary: string[];
}

export interface RelationObservation {
  subjectId: string;
  objectId: string;
  predicate: string;
  score: number;
  timestampMs: number;
  providerId: string;
}

export interface RelationProvider {
  initialize(): Promise<RelationProviderMetadata>;
  score(input: RelationInput): Promise<RelationObservation[]>;
  getMetadata(): RelationProviderMetadata | null;
  dispose(): Promise<void> | void;
}

export type RelationEvaluability =
  | 'evaluated'
  | 'subject_not_observable'
  | 'object_not_observable'
  | 'provider_unavailable'
  | 'pair_not_scored';

export interface RelationFrameState {
  subjectId: string;
  subjectKind: RelationEndpointKind;
  objectId: string;
  objectKind: RelationEndpointKind;
  predicate: string;
  timestampMs: number;
  evaluability: RelationEvaluability;
  score?: number;
}

export interface ActivityEpisode {
  episodeId: string;
  sessionId: string;
  startMs: number;
  endMs?: number;
  trackIds: string[];
  predicate: string;
  semanticElementIds: string[];
  confidence: number;
  sourceObservationCount: number;
}
