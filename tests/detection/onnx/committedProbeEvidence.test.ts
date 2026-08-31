import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { OPENCV_SSD_MOBILENET_V2_COCO_2026JUL } from '../../../src/detection/modelCandidates';
import { reviewImportedProbeDiagnostic } from '../../../src/detection/onnx/probeDiagnosticReview';

const evidencePath = 'docs/benchmarks/evidence/opencv-ssd-mobilenet-v2-coco-2026jul-probe.json';

describe('committed OpenCV SSD probe evidence', () => {
  it('remains technically verified against the current registry and gate', async () => {
    const text = await readFile(evidencePath, 'utf8');
    const review = reviewImportedProbeDiagnostic(text);
    expect(review.candidate.id).toBe(OPENCV_SSD_MOBILENET_V2_COCO_2026JUL.id);
    expect(review.candidate.status).toBe('probe_verified');
    expect(review.verification.status).toBe('verified');
    expect(review.verification.findings).toEqual([]);
    expect(review.diagnostic.probe.runtimeSmoke?.passed).toBe(true);
    expect(review.diagnostic.probe.artifact.sha256).toBe(OPENCV_SSD_MOBILENET_V2_COCO_2026JUL.artifact.sha256);
  });
});
