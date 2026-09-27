import { describe, expect, it } from 'vitest';
import evidenceText from '../../docs/benchmarks/evidence/relateanything-vits16plus-ort-web-wasm-smoke.json?raw';
import {
  RELATEANYTHING_VITS16PLUS_2026_08_27,
} from '../../src/relations/relateAnythingOnnx';

interface SmokeEvidence {
  candidateId: string;
  artifacts: {
    model: {
      sha256: string;
      sizeBytes: number;
    };
  };
  release: {
    modelRepo: string;
    externalDataCandidates: string[];
    upstreamProvenanceContent: {
      img_size: number;
      max_boxes: number;
      final_budget: number;
      vocab_mode: string;
      text_dim: number;
      outputs: string[];
      calibration: { a: number; b: number };
      git_sha: string;
      exported: string;
    };
  };
  bank: {
    names: string[];
    dim: number;
    thresholdsFromBank: Array<number | null>;
  };
  runtime: {
    passed: boolean;
    selectedSessionAttempt: string | null;
    findings: string[];
    inferenceMs: number | null;
    outputs: Array<{
      name: string;
      shape: Array<number | string>;
      nonFiniteCount: number;
    }>;
  };
}

describe('committed RelateAnything vits16plus runtime evidence', () => {
  it('remains aligned with the pinned runtime-verified release contract', () => {
    const evidence = JSON.parse(evidenceText) as SmokeEvidence;
    const contract = RELATEANYTHING_VITS16PLUS_2026_08_27;

    expect(evidence.candidateId).toContain('maelic/relsgg-vits16plus@');
    expect(evidence.artifacts.model.sha256).toBe(contract.modelSha256);
    expect(evidence.artifacts.model.sizeBytes).toBeGreaterThan(200_000_000);

    expect(evidence.release.modelRepo).toBe('maelic/relsgg-vits16plus');
    expect(evidence.release.externalDataCandidates).toEqual([]);
    expect(evidence.release.upstreamProvenanceContent.img_size).toBe(contract.imgSize);
    expect(evidence.release.upstreamProvenanceContent.max_boxes).toBe(contract.maxBoxes);
    expect(evidence.release.upstreamProvenanceContent.final_budget).toBe(contract.finalBudget);
    expect(evidence.release.upstreamProvenanceContent.vocab_mode).toBe(contract.vocabMode);
    expect(evidence.release.upstreamProvenanceContent.text_dim).toBe(contract.textDim);
    expect(evidence.release.upstreamProvenanceContent.outputs).toEqual([
      contract.outputs.predLogits,
      contract.outputs.pairLogits,
      contract.outputs.subjectIndex,
      contract.outputs.objectIndex,
      contract.outputs.validMask,
    ]);
    expect(evidence.release.upstreamProvenanceContent.calibration).toEqual(
      contract.calibration,
    );
    expect(evidence.release.upstreamProvenanceContent.git_sha.startsWith('e9ea42a'))
      .toBe(true);
    expect(evidence.release.upstreamProvenanceContent.exported).toBe('2026-08-27');

    expect(evidence.bank.dim).toBe(contract.textDim);
    expect(evidence.bank.names).toEqual([
      'sitting on',
      'leaning against',
      'talking to',
      'riding',
      'holding',
    ]);
    expect(evidence.bank.thresholdsFromBank.every(
      (value) => value !== null && value >= 0.95,
    )).toBe(true);

    expect(evidence.runtime.passed).toBe(true);
    expect(evidence.runtime.selectedSessionAttempt).toBe('single_file');
    expect(evidence.runtime.findings).toEqual([]);
    expect(evidence.runtime.inferenceMs).toBeGreaterThan(0);

    const outputs = new Map(
      evidence.runtime.outputs.map((output) => [output.name, output]),
    );
    expect(outputs.get('pred_logits')?.shape).toEqual([1, 128, 5]);
    expect(outputs.get('pair_logits')?.shape).toEqual([1, 128]);
    expect(outputs.get('sub_idx')?.shape).toEqual([1, 128]);
    expect(outputs.get('obj_idx')?.shape).toEqual([1, 128]);
    expect(outputs.get('valid_mask')?.shape).toEqual([1, 128]);
    expect(evidence.runtime.outputs.every(
      (output) => output.nonFiniteCount === 0,
    )).toBe(true);
  });
});
