import type { BoundingBox } from '../core/types';
import type { TrackedEntity } from '../tracking/multiObjectTracker';
import {
  semanticElementBoundingBox,
  validateSemanticPublicSpaceMap,
  type SemanticPublicSpaceElement,
  type SemanticPublicSpaceMap,
} from './semanticMap';
import { selectRelationCandidates, type RelationCandidateGateConfig } from '../relations/candidateGate';
import {
  RelationSamplingGate,
  type RelationSamplingConfig,
  type RelationSamplingPlan,
} from '../relations/samplingGate';
import {
  RelationTemporalPersistence,
  type ActiveRelationState,
  type RelationTemporalPersistenceConfig,
} from '../relations/temporalPersistence';
import type {
  ActivityEpisode,
  RelationCandidate,
  RelationEndpoint,
  RelationFrameState,
  RelationObservation,
  RelationProvider,
  RelationProviderMetadata,
} from '../relations/types';

export interface PublicLifeRuntimeInput {
  source: CanvasImageSource;
  sourceWidth: number;
  sourceHeight: number;
  timestampMs: number;
  tracks: readonly TrackedEntity[];
}

export interface PublicLifeRuntimeOptions {
  sessionId: string;
  provider: RelationProvider;
  semanticMap: SemanticPublicSpaceMap;
  vocabulary: readonly string[];
  candidateGate?: Partial<RelationCandidateGateConfig>;
  sampling?: Partial<RelationSamplingConfig>;
  persistence?: Partial<RelationTemporalPersistenceConfig>;
  localGroundElementToImageBbox?: (
    element: SemanticPublicSpaceElement,
    sourceWidth: number,
    sourceHeight: number,
  ) => BoundingBox | undefined;
}

export type PublicLifeProviderStatus =
  | 'not_initialized'
  | 'skipped'
  | 'completed'
  | 'failed';

export interface PublicLifeRuntimeFrame {
  timestampMs: number;
  trackEndpointCount: number;
  staticEndpointCount: number;
  skippedStaticElementCount: number;
  candidateCount: number;
  sampling: RelationSamplingPlan;
  observations: RelationObservation[];
  frameStates: RelationFrameState[];
  activeRelations: ActiveRelationState[];
  completedEpisodes: ActivityEpisode[];
  providerStatus: PublicLifeProviderStatus;
  providerMs: number;
  providerError?: string;
}

function finitePositive(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be finite and > 0`);
  }
  return value;
}

function cloneBox(box: BoundingBox): BoundingBox {
  return { ...box };
}

function scaleBox(
  box: BoundingBox,
  sourceWidth: number,
  sourceHeight: number,
): BoundingBox {
  return {
    x: box.x * sourceWidth,
    y: box.y * sourceHeight,
    width: box.width * sourceWidth,
    height: box.height * sourceHeight,
  };
}

function validBox(box: BoundingBox): boolean {
  return [box.x, box.y, box.width, box.height].every(Number.isFinite)
    && box.width > 0
    && box.height > 0;
}

function trackEndpoint(track: TrackedEntity): RelationEndpoint | undefined {
  if (track.state !== 'confirmed') return undefined;
  const sample = track.samples.at(-1);
  if (!sample || !validBox(sample.bbox)) return undefined;
  return {
    kind: 'track',
    id: track.id,
    bbox: cloneBox(sample.bbox),
    entityType: track.entityType,
    confidence: track.quality,
  };
}

interface StaticEndpointBuild {
  endpoint?: RelationEndpoint;
  skipped: boolean;
}

function staticEndpoint(
  element: SemanticPublicSpaceElement,
  sourceWidth: number,
  sourceHeight: number,
  localGroundResolver:
    | PublicLifeRuntimeOptions['localGroundElementToImageBbox']
    | undefined,
): StaticEndpointBuild {
  let bbox: BoundingBox | undefined;

  if (element.geometry.space === 'image') {
    bbox = semanticElementBoundingBox(element);
  } else if (element.geometry.space === 'normalized_image') {
    bbox = scaleBox(
      semanticElementBoundingBox(element),
      sourceWidth,
      sourceHeight,
    );
  } else {
    bbox = localGroundResolver?.(element, sourceWidth, sourceHeight);
  }

  if (!bbox || !validBox(bbox)) return { skipped: true };
  return {
    skipped: false,
    endpoint: {
      kind: 'static_element',
      id: element.id,
      bbox: cloneBox(bbox),
      elementType: element.type,
      confidence: 1,
    },
  };
}

function pairId(subjectId: string, objectId: string): string {
  return JSON.stringify([subjectId, objectId]);
}

function observationId(
  subjectId: string,
  predicate: string,
  objectId: string,
): string {
  return JSON.stringify([subjectId, predicate, objectId]);
}

function providerErrorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function endpointIdSet(endpoints: readonly RelationEndpoint[]): Set<string> {
  const result = new Set<string>();
  for (const endpoint of endpoints) {
    if (result.has(endpoint.id)) {
      throw new Error(
        `Public Life runtime requires globally unique endpoint ids; duplicate: ${endpoint.id}`,
      );
    }
    result.add(endpoint.id);
  }
  return result;
}

function candidateByPair(
  candidates: readonly RelationCandidate[],
): Map<string, RelationCandidate> {
  const result = new Map<string, RelationCandidate>();
  for (const candidate of candidates) {
    result.set(
      pairId(candidate.subject.id, candidate.object.id),
      candidate,
    );
  }
  return result;
}

function observationAllowedBySemanticElement(
  observation: RelationObservation,
  semanticById: ReadonlyMap<string, SemanticPublicSpaceElement>,
): boolean {
  const element = semanticById.get(observation.objectId);
  if (!element?.relationVocabulary || element.relationVocabulary.length === 0) {
    return true;
  }
  return element.relationVocabulary.includes(observation.predicate);
}

/**
 * Experimental orchestrator for Public Life inference.
 *
 * It intentionally sits beside MobilityFrameProcessor rather than inside it.
 * This keeps relation inference optional until runtime, corpus and methodology
 * gates are satisfied.
 */
export class PublicLifeRuntime {
  private readonly provider: RelationProvider;
  private readonly semanticMap: SemanticPublicSpaceMap;
  private readonly semanticById: Map<string, SemanticPublicSpaceElement>;
  private readonly vocabulary: string[];
  private readonly candidateGate: Partial<RelationCandidateGateConfig>;
  private readonly sampler: RelationSamplingGate;
  private readonly persistence: RelationTemporalPersistence;
  private readonly localGroundElementToImageBbox:
    | PublicLifeRuntimeOptions['localGroundElementToImageBbox']
    | undefined;
  private metadata: RelationProviderMetadata | null = null;

  constructor(options: PublicLifeRuntimeOptions) {
    if (options.sessionId.trim().length === 0) {
      throw new Error('Public Life runtime sessionId is required');
    }
    const mapValidation = validateSemanticPublicSpaceMap(options.semanticMap);
    if (!mapValidation.valid) {
      throw new Error(
        `Invalid SemanticPublicSpaceMap: ${mapValidation.issues.join(', ')}`,
      );
    }
    const vocabulary = [...new Set(
      options.vocabulary.map((item) => item.trim()).filter(Boolean),
    )];
    if (vocabulary.length === 0) {
      throw new Error('Public Life runtime vocabulary must not be empty');
    }

    this.provider = options.provider;
    this.semanticMap = {
      ...options.semanticMap,
      elements: options.semanticMap.elements.map((element) => ({
        ...element,
        geometry: {
          ...element.geometry,
          polygon: element.geometry.polygon.map((point) => ({ ...point })),
        },
        ...(element.relationVocabulary === undefined
          ? {}
          : { relationVocabulary: [...element.relationVocabulary] }),
      })),
    };
    this.semanticById = new Map(
      this.semanticMap.elements.map((element) => [element.id, element]),
    );
    this.vocabulary = vocabulary;
    this.candidateGate = { ...options.candidateGate };
    this.sampler = new RelationSamplingGate(options.sampling);
    this.persistence = new RelationTemporalPersistence(
      options.sessionId,
      options.persistence,
    );
    this.localGroundElementToImageBbox = options.localGroundElementToImageBbox;
  }

  async initialize(): Promise<RelationProviderMetadata> {
    if (this.metadata) return { ...this.metadata };
    this.metadata = await this.provider.initialize();
    return { ...this.metadata };
  }

  getProviderMetadata(): RelationProviderMetadata | null {
    return this.metadata ? { ...this.metadata } : null;
  }

  reset(): void {
    this.sampler.reset();
    this.persistence.reset();
  }

  async process(input: PublicLifeRuntimeInput): Promise<PublicLifeRuntimeFrame> {
    if (!this.metadata) {
      throw new Error('PublicLifeRuntime must be initialized before process()');
    }
    finitePositive(input.sourceWidth, 'sourceWidth');
    finitePositive(input.sourceHeight, 'sourceHeight');
    if (!Number.isFinite(input.timestampMs)) {
      throw new Error('timestampMs must be finite');
    }

    const trackEndpoints = input.tracks
      .map(trackEndpoint)
      .filter((endpoint): endpoint is RelationEndpoint => endpoint !== undefined);

    const staticEndpoints: RelationEndpoint[] = [];
    let skippedStaticElementCount = 0;
    for (const element of this.semanticMap.elements) {
      const result = staticEndpoint(
        element,
        input.sourceWidth,
        input.sourceHeight,
        this.localGroundElementToImageBbox,
      );
      if (!result.endpoint) {
        skippedStaticElementCount += 1;
        continue;
      }
      staticEndpoints.push(result.endpoint);
    }

    const endpoints = [...trackEndpoints, ...staticEndpoints];
    const endpointIds = endpointIdSet(endpoints);
    const candidates = selectRelationCandidates(endpoints, this.candidateGate);
    const candidatesByPair = candidateByPair(candidates);
    const sampling = this.sampler.plan(candidates, input.timestampMs);
    const selectedCandidates = sampling.selected.map((item) => item.candidate);

    const frameStates: RelationFrameState[] = [];
    const observations: RelationObservation[] = [];
    let providerStatus: PublicLifeProviderStatus = selectedCandidates.length === 0
      ? 'skipped'
      : 'completed';
    let providerMs = 0;
    let providerError: string | undefined;

    const activeBefore = this.persistence.getActiveRelations();

    // If an active endpoint disappeared from the frame/map, make that
    // observability loss explicit. A skipped sampling frame does not do this.
    for (const active of activeBefore) {
      if (!endpointIds.has(active.subjectId)) {
        frameStates.push({
          subjectId: active.subjectId,
          subjectKind: active.subjectKind,
          objectId: active.objectId,
          objectKind: active.objectKind,
          predicate: active.predicate,
          timestampMs: input.timestampMs,
          evaluability: 'subject_not_observable',
        });
      } else if (!endpointIds.has(active.objectId)) {
        frameStates.push({
          subjectId: active.subjectId,
          subjectKind: active.subjectKind,
          objectId: active.objectId,
          objectKind: active.objectKind,
          predicate: active.predicate,
          timestampMs: input.timestampMs,
          evaluability: 'object_not_observable',
        });
      } else if (!candidatesByPair.has(pairId(active.subjectId, active.objectId))) {
        frameStates.push({
          subjectId: active.subjectId,
          subjectKind: active.subjectKind,
          objectId: active.objectId,
          objectKind: active.objectKind,
          predicate: active.predicate,
          timestampMs: input.timestampMs,
          evaluability: 'pair_not_scored',
        });
      }
    }

    if (selectedCandidates.length > 0) {
      const startedAt = performance.now();
      try {
        const scored = await this.provider.score({
          source: input.source,
          sourceWidth: input.sourceWidth,
          sourceHeight: input.sourceHeight,
          timestampMs: input.timestampMs,
          candidates: selectedCandidates,
          vocabulary: [...this.vocabulary],
        });
        providerMs = Math.max(0, performance.now() - startedAt);
        observations.push(
          ...scored.filter((observation) =>
            observationAllowedBySemanticElement(observation, this.semanticById)),
        );
        this.sampler.recordEvaluation(sampling.selected, input.timestampMs);

        const selectedByPair = candidateByPair(selectedCandidates);
        const observationKeys = new Set<string>();

        for (const observation of observations) {
          const candidate = selectedByPair.get(
            pairId(observation.subjectId, observation.objectId),
          );
          if (!candidate) continue;
          observationKeys.add(
            observationId(
              observation.subjectId,
              observation.predicate,
              observation.objectId,
            ),
          );
          frameStates.push({
            subjectId: observation.subjectId,
            subjectKind: candidate.subject.kind,
            objectId: observation.objectId,
            objectKind: candidate.object.kind,
            predicate: observation.predicate,
            timestampMs: input.timestampMs,
            evaluability: 'evaluated',
            score: observation.score,
          });
        }

        // Only active relations need explicit missing-output handling. This
        // avoids creating persistence state for every negative candidate.
        for (const active of activeBefore) {
          const selected = selectedByPair.get(
            pairId(active.subjectId, active.objectId),
          );
          if (!selected) continue;
          const key = observationId(
            active.subjectId,
            active.predicate,
            active.objectId,
          );
          if (observationKeys.has(key)) continue;

          if (this.metadata.scoreSemantics === 'dense') {
            frameStates.push({
              subjectId: active.subjectId,
              subjectKind: active.subjectKind,
              objectId: active.objectId,
              objectKind: active.objectKind,
              predicate: active.predicate,
              timestampMs: input.timestampMs,
              evaluability: 'evaluated',
              score: 0,
            });
          } else {
            frameStates.push({
              subjectId: active.subjectId,
              subjectKind: active.subjectKind,
              objectId: active.objectId,
              objectKind: active.objectKind,
              predicate: active.predicate,
              timestampMs: input.timestampMs,
              evaluability: 'pair_not_scored',
            });
          }
        }
      } catch (error) {
        providerMs = Math.max(0, performance.now() - startedAt);
        providerStatus = 'failed';
        providerError = providerErrorText(error);

        const selectedPairs = candidateByPair(selectedCandidates);
        for (const active of activeBefore) {
          if (!selectedPairs.has(pairId(active.subjectId, active.objectId))) {
            continue;
          }
          frameStates.push({
            subjectId: active.subjectId,
            subjectKind: active.subjectKind,
            objectId: active.objectId,
            objectKind: active.objectKind,
            predicate: active.predicate,
            timestampMs: input.timestampMs,
            evaluability: 'provider_unavailable',
          });
        }
      }
    }

    const temporal = this.persistence.update(frameStates, input.timestampMs);

    return {
      timestampMs: input.timestampMs,
      trackEndpointCount: trackEndpoints.length,
      staticEndpointCount: staticEndpoints.length,
      skippedStaticElementCount,
      candidateCount: candidates.length,
      sampling,
      observations,
      frameStates,
      activeRelations: temporal.activeRelations,
      completedEpisodes: temporal.completedEpisodes,
      providerStatus,
      providerMs,
      ...(providerError === undefined ? {} : { providerError }),
    };
  }

  flush(timestampMs: number): ActivityEpisode[] {
    return this.persistence.flush(timestampMs);
  }

  async dispose(): Promise<void> {
    this.reset();
    this.metadata = null;
    await this.provider.dispose();
  }
}
