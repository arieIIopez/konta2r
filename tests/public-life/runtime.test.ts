import { describe, expect, it } from 'vitest';
import type { TrackedEntity } from '../../src/tracking/multiObjectTracker';
import {
  PublicLifeRuntime,
  type PublicLifeRuntimeInput,
} from '../../src/public-life/runtime';
import type { SemanticPublicSpaceMap } from '../../src/public-life/semanticMap';
import type {
  RelationInput,
  RelationObservation,
  RelationProvider,
  RelationProviderMetadata,
  RelationScoreSemantics,
} from '../../src/relations/types';

class FakeRelationProvider implements RelationProvider {
  calls: RelationInput[] = [];
  initializeCalls = 0;
  failNext = false;
  private metadata: RelationProviderMetadata | null = null;

  constructor(
    private readonly semantics: RelationScoreSemantics,
    private readonly outputs: RelationObservation[][],
  ) {}

  async initialize(): Promise<RelationProviderMetadata> {
    this.initializeCalls += 1;
    this.metadata = {
      providerId: 'fake-provider',
      modelId: 'fake-model',
      modelVersion: '1',
      runtime: 'other',
      scoreSemantics: this.semantics,
      weightsRedistributionVerified: true,
    };
    return { ...this.metadata };
  }

  getMetadata(): RelationProviderMetadata | null {
    return this.metadata ? { ...this.metadata } : null;
  }

  async score(input: RelationInput): Promise<RelationObservation[]> {
    this.calls.push(input);
    if (this.failNext) {
      this.failNext = false;
      throw new Error('simulated provider failure');
    }
    return this.outputs.shift() ?? [];
  }

  dispose(): void {
    this.metadata = null;
  }
}

function track(id = 't_1', x = 100): TrackedEntity {
  return {
    id,
    entityType: 'pedestrian',
    state: 'confirmed',
    createdAtMs: 0,
    updatedAtMs: 0,
    samples: [{
      timestampMs: 0,
      point: { x: x + 20, y: 180 },
      bbox: { x, y: 100, width: 40, height: 160 },
      confidence: 0.9,
    }],
    hits: 5,
    totalMisses: 0,
    consecutiveMisses: 0,
    velocity: { xPxPerMs: 0, yPxPerMs: 0 },
    quality: 0.9,
    lastObservationConfidence: 0.9,
  };
}

function map(
  space: 'image' | 'normalized_image' | 'local_ground' = 'image',
): SemanticPublicSpaceMap {
  const polygon = space === 'normalized_image'
    ? [
        { x: 0.12, y: 0.4 },
        { x: 0.35, y: 0.4 },
        { x: 0.35, y: 0.6 },
        { x: 0.12, y: 0.6 },
      ]
    : [
        { x: 120, y: 220 },
        { x: 350, y: 220 },
        { x: 350, y: 320 },
        { x: 120, y: 320 },
      ];
  return {
    mapId: 'site-map',
    version: 1,
    elements: [{
      id: 'bench_01',
      type: 'bench',
      geometry: { space, polygon },
      relationVocabulary: ['sitting on'],
    }],
  };
}

function input(timestampMs: number): PublicLifeRuntimeInput {
  return {
    source: {} as CanvasImageSource,
    sourceWidth: 1000,
    sourceHeight: 500,
    timestampMs,
    tracks: [track()],
  };
}

function sittingObservation(timestampMs: number, score = 0.9): RelationObservation {
  return {
    subjectId: 't_1',
    objectId: 'bench_01',
    predicate: 'sitting on',
    score,
    timestampMs,
    providerId: 'fake-provider',
  };
}

describe('Public Life experimental runtime', () => {
  it('orchestrates tracks, normalized semantic elements, gating and provider scoring', async () => {
    const provider = new FakeRelationProvider(
      'thresholded_partial',
      [[sittingObservation(0)]],
    );
    const runtime = new PublicLifeRuntime({
      sessionId: 'session-1',
      provider,
      semanticMap: map('normalized_image'),
      vocabulary: ['sitting on'],
      sampling: { minIntervalMs: 0 },
      persistence: { minOpenSamples: 1 },
    });

    const metadata = await runtime.initialize();
    const frame = await runtime.process(input(0));

    expect(metadata.scoreSemantics).toBe('thresholded_partial');
    expect(frame.trackEndpointCount).toBe(1);
    expect(frame.staticEndpointCount).toBe(1);
    expect(frame.skippedStaticElementCount).toBe(0);
    expect(frame.candidateCount).toBeGreaterThan(0);
    expect(frame.providerStatus).toBe('completed');
    expect(frame.observations).toHaveLength(1);
    expect(frame.activeRelations).toHaveLength(1);

    const staticCandidate = provider.calls[0]?.candidates.find(
      (candidate) => candidate.object.id === 'bench_01',
    );
    expect(staticCandidate?.object.bbox).toEqual({
      x: 120,
      y: 200,
      width: 230,
      height: 100,
    });
  });

  it('treats a missing thresholded output as pair_not_scored rather than negative evidence', async () => {
    const provider = new FakeRelationProvider(
      'thresholded_partial',
      [[sittingObservation(0)], [], []],
    );
    const runtime = new PublicLifeRuntime({
      sessionId: 'session-1',
      provider,
      semanticMap: map(),
      vocabulary: ['sitting on'],
      sampling: { minIntervalMs: 0 },
      persistence: {
        minOpenSamples: 1,
        scoreSmoothing: 1,
        maxUnobservableMs: 1_000,
      },
    });

    await runtime.initialize();
    const opened = await runtime.process(input(0));
    expect(opened.activeRelations).toHaveLength(1);

    const missing = await runtime.process(input(100));
    expect(missing.frameStates).toContainEqual(expect.objectContaining({
      predicate: 'sitting on',
      evaluability: 'pair_not_scored',
    }));
    expect(missing.activeRelations).toHaveLength(1);
    expect(missing.completedEpisodes).toEqual([]);

    const expired = await runtime.process(input(1_200));
    expect(expired.activeRelations).toHaveLength(0);
    expect(expired.completedEpisodes).toHaveLength(1);
    expect(expired.completedEpisodes[0]?.endMs).toBe(100);
  });

  it('allows dense providers to close an active relation with explicit zero evidence', async () => {
    const provider = new FakeRelationProvider(
      'dense',
      [[sittingObservation(0)], []],
    );
    const runtime = new PublicLifeRuntime({
      sessionId: 'session-1',
      provider,
      semanticMap: map(),
      vocabulary: ['sitting on'],
      sampling: { minIntervalMs: 0 },
      persistence: {
        minOpenSamples: 1,
        scoreSmoothing: 1,
        openThreshold: 0.65,
        closeThreshold: 0.35,
      },
    });

    await runtime.initialize();
    await runtime.process(input(0));
    const closed = await runtime.process(input(100));

    expect(closed.frameStates).toContainEqual(expect.objectContaining({
      predicate: 'sitting on',
      evaluability: 'evaluated',
      score: 0,
    }));
    expect(closed.completedEpisodes).toHaveLength(1);
    expect(closed.completedEpisodes[0]?.endMs).toBe(100);
  });

  it('does not create negative evidence merely because temporal sampling skipped a frame', async () => {
    const provider = new FakeRelationProvider(
      'thresholded_partial',
      [[sittingObservation(0)]],
    );
    const runtime = new PublicLifeRuntime({
      sessionId: 'session-1',
      provider,
      semanticMap: map(),
      vocabulary: ['sitting on'],
      sampling: { minIntervalMs: 10_000 },
      persistence: { minOpenSamples: 1 },
    });

    await runtime.initialize();
    await runtime.process(input(0));
    const skipped = await runtime.process(input(100));

    expect(skipped.providerStatus).toBe('skipped');
    expect(skipped.frameStates).toEqual([]);
    expect(skipped.activeRelations).toHaveLength(1);
    expect(provider.calls).toHaveLength(1);
  });

  it('does not record sampling success when the provider fails and retries the pair', async () => {
    const provider = new FakeRelationProvider(
      'thresholded_partial',
      [[sittingObservation(100)]],
    );
    provider.failNext = true;
    const runtime = new PublicLifeRuntime({
      sessionId: 'session-1',
      provider,
      semanticMap: map(),
      vocabulary: ['sitting on'],
      sampling: { minIntervalMs: 10_000 },
      persistence: { minOpenSamples: 1 },
    });

    await runtime.initialize();
    const failed = await runtime.process(input(0));
    const retry = await runtime.process(input(100));

    expect(failed.providerStatus).toBe('failed');
    expect(failed.providerError).toContain('simulated provider failure');
    expect(retry.providerStatus).toBe('completed');
    expect(retry.sampling.selected[0]?.reason).toBe('new_pair');
    expect(provider.calls).toHaveLength(2);
  });

  it('skips local-ground semantic elements when no image projection is available', async () => {
    const provider = new FakeRelationProvider('thresholded_partial', []);
    const runtime = new PublicLifeRuntime({
      sessionId: 'session-1',
      provider,
      semanticMap: map('local_ground'),
      vocabulary: ['sitting on'],
    });

    await runtime.initialize();
    const frame = await runtime.process(input(0));

    expect(frame.staticEndpointCount).toBe(0);
    expect(frame.skippedStaticElementCount).toBe(1);
    expect(frame.candidateCount).toBe(0);
    expect(frame.providerStatus).toBe('skipped');
  });

  it('filters model predicates that a semantic element did not authorize', async () => {
    const provider = new FakeRelationProvider(
      'thresholded_partial',
      [[{
        subjectId: 't_1',
        objectId: 'bench_01',
        predicate: 'talking to',
        score: 0.95,
        timestampMs: 0,
        providerId: 'fake-provider',
      }]],
    );
    const runtime = new PublicLifeRuntime({
      sessionId: 'session-1',
      provider,
      semanticMap: map(),
      vocabulary: ['sitting on', 'talking to'],
      sampling: { minIntervalMs: 0 },
    });

    await runtime.initialize();
    const frame = await runtime.process(input(0));

    expect(frame.observations).toEqual([]);
    expect(frame.activeRelations).toEqual([]);
  });
});
