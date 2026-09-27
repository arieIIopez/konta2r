import { describe, expect, it } from 'vitest';
import type { OnnxSessionFactory, OnnxSessionLike, OnnxValueMap } from '../../src/detection/onnx/runtime';
import {
  RELATEANYTHING_VITS16_2026_08_27,
  RelateAnythingOnnxProvider,
  relateAnythingScore,
  relationBoxesCxCyWh,
  type RelateAnythingPredicateBank,
} from '../../src/relations/relateAnythingOnnx';
import type { RelationCandidate } from '../../src/relations/types';

class FakeSession implements OnnxSessionLike {
  public lastFeeds: OnnxValueMap | null = null;

  async run(feeds: OnnxValueMap): Promise<OnnxValueMap> {
    this.lastFeeds = feeds;
    return {
      pred_logits: { data: new Float32Array([2, -2]) },
      pair_logits: { data: new Float32Array([0]) },
      sub_idx: { data: BigInt64Array.from([0n]) },
      obj_idx: { data: BigInt64Array.from([1n]) },
      valid_mask: { data: new Uint8Array([1]) },
    };
  }

  release(): void {}
}

function factory(session: FakeSession): OnnxSessionFactory {
  return {
    async create(): Promise<OnnxSessionLike> {
      return session;
    },
  };
}

const bank: RelateAnythingPredicateBank = {
  names: ['riding', 'sitting on'],
  dim: 2,
  W: [
    [1, 0],
    [0, 1],
  ],
  alpha: [0.5, 0.6],
  thr: [0.5, 0.5],
};

const candidate: RelationCandidate = {
  subject: {
    kind: 'track',
    id: 't_1',
    entityType: 'pedestrian',
    confidence: 0.9,
    bbox: { x: 10, y: 20, width: 20, height: 40 },
  },
  object: {
    kind: 'static_element',
    id: 'bench_1',
    elementType: 'bench',
    bbox: { x: 40, y: 30, width: 30, height: 20 },
  },
  priority: 1,
  reason: 'spatial_proximity',
};

describe('RelateAnything ONNX provider', () => {
  it('implements the released score contract', () => {
    expect(
      relateAnythingScore(2, 0, { calibA: 1, calibB: 0, pairWeight: 1 }),
    ).toBeCloseTo(0.880797, 6);
    expect(
      relateAnythingScore(-2, 0, { calibA: 1, calibB: 0, pairWeight: 1 }),
    ).toBeCloseTo(0.119203, 6);
  });

  it('normalizes endpoint boxes to cxcywh and pads to the model budget', () => {
    const boxes = relationBoxesCxCyWh(
      [candidate.subject, candidate.object],
      100,
      100,
      4,
    );

    expect([...boxes.slice(0, 8)]).toEqual([
      0.2, 0.4, 0.2, 0.4,
      0.55, 0.4, 0.3, 0.2,
    ]);
    expect(boxes).toHaveLength(16);
  });

  it('runs the dynamic vocabulary contract and returns only allowed directed pairs', async () => {
    const session = new FakeSession();
    const contract = {
      ...RELATEANYTHING_VITS16_2026_08_27,
      imgSize: 2,
      maxBoxes: 4,
      finalBudget: 1,
      textDim: 2,
      calibration: { a: 1, b: 0 },
      predicates: ['riding', 'sitting on'],
    };
    const provider = new RelateAnythingOnnxProvider({
      contract,
      modelSource: new Uint8Array([1]),
      bank,
      sessionFactory: factory(session),
      capabilities: { webgpu: false },
      resizeRgb: () => new Uint8Array([
        255, 0, 0,
        0, 255, 0,
        0, 0, 255,
        255, 255, 255,
      ]),
      maxPredicatesPerPair: 1,
    });

    await provider.initialize();
    const observations = await provider.score({
      source: {} as CanvasImageSource,
      sourceWidth: 100,
      sourceHeight: 100,
      timestampMs: 1234,
      candidates: [candidate],
      vocabulary: ['riding', 'sitting on'],
    });

    expect(observations).toHaveLength(1);
    expect(observations[0]?.subjectId).toBe('t_1');
    expect(observations[0]?.objectId).toBe('bench_1');
    expect(observations[0]?.predicate).toBe('riding');
    expect(observations[0]?.score).toBeCloseTo(0.880797, 6);

    const image = session.lastFeeds?.image as { dims?: readonly number[] };
    const boxes = session.lastFeeds?.boxes as { dims?: readonly number[] };
    const W = session.lastFeeds?.W as { dims?: readonly number[] };
    const alpha = session.lastFeeds?.alpha as { dims?: readonly number[] };
    expect(image.dims).toEqual([1, 3, 2, 2]);
    expect(boxes.dims).toEqual([1, 4, 4]);
    expect(W.dims).toEqual([2, 2]);
    expect(alpha.dims).toEqual([2]);

    await provider.dispose();
  });

  it('refuses open-vocabulary strings that have not been encoded into the supplied bank', async () => {
    const session = new FakeSession();
    const provider = new RelateAnythingOnnxProvider({
      contract: {
        ...RELATEANYTHING_VITS16_2026_08_27,
        imgSize: 2,
        maxBoxes: 4,
        textDim: 2,
        predicates: ['riding', 'sitting on'],
      },
      modelSource: new Uint8Array([1]),
      bank,
      sessionFactory: factory(session),
      capabilities: { webgpu: false },
      resizeRgb: () => new Uint8Array(12),
    });

    await provider.initialize();
    await expect(provider.score({
      source: {} as CanvasImageSource,
      sourceWidth: 100,
      sourceHeight: 100,
      timestampMs: 1,
      candidates: [candidate],
      vocabulary: ['walking with'],
    })).rejects.toThrow('not present in the supplied bank');

    await provider.dispose();
  });

  it('does not emit a model pair that was not approved by the candidate gate', async () => {
    class ReverseSession extends FakeSession {
      override async run(feeds: OnnxValueMap): Promise<OnnxValueMap> {
        this.lastFeeds = feeds;
        return {
          pred_logits: { data: new Float32Array([2, -2]) },
          pair_logits: { data: new Float32Array([0]) },
          sub_idx: { data: BigInt64Array.from([1n]) },
          obj_idx: { data: BigInt64Array.from([0n]) },
          valid_mask: { data: new Uint8Array([1]) },
        };
      }
    }

    const session = new ReverseSession();
    const provider = new RelateAnythingOnnxProvider({
      contract: {
        ...RELATEANYTHING_VITS16_2026_08_27,
        imgSize: 2,
        maxBoxes: 4,
        textDim: 2,
        calibration: { a: 1, b: 0 },
        predicates: ['riding', 'sitting on'],
      },
      modelSource: new Uint8Array([1]),
      bank,
      sessionFactory: factory(session),
      capabilities: { webgpu: false },
      resizeRgb: () => new Uint8Array(12),
    });

    await provider.initialize();
    const observations = await provider.score({
      source: {} as CanvasImageSource,
      sourceWidth: 100,
      sourceHeight: 100,
      timestampMs: 1,
      candidates: [candidate],
      vocabulary: ['riding', 'sitting on'],
    });

    expect(observations).toEqual([]);
    await provider.dispose();
  });
});
