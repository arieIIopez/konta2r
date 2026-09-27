import { describe, expect, it } from 'vitest';
import nanodetEvidenceText from '../../../docs/benchmarks/evidence/opencv-nanodet-m-plus-1.5x-416-2022nov-probe.json?raw';
import ssdEvidenceText from '../../../docs/benchmarks/evidence/opencv-ssd-mobilenet-v2-coco-2026jul-probe.json?raw';
import {
  OPENCV_NANODET_M_PLUS_1_5X_416,
  OPENCV_SSD_MOBILENET_V2_COCO_2026JUL,
} from '../../../src/detection/modelCandidates';
import { reviewImportedProbeDiagnostic } from '../../../src/detection/onnx/probeDiagnosticReview';

function expectVerifiedEvidence(
  evidenceText: string,
  candidate: typeof OPENCV_SSD_MOBILENET_V2_COCO_2026JUL,
): void {
  const review = reviewImportedProbeDiagnostic(evidenceText);
  expect(review.candidate.id).toBe(candidate.id);
  expect(review.candidate.status).toBe('probe_verified');
  expect(review.verification.status).toBe('verified');
  expect(review.verification.findings).toEqual([]);
  expect(review.diagnostic.probe.runtimeSmoke?.passed).toBe(true);
  expect(review.diagnostic.probe.artifact.sha256).toBe(candidate.artifact.sha256);
}

describe('committed detector probe evidence', () => {
  it('keeps the OpenCV SSD baseline technically verified', () => {
    expectVerifiedEvidence(ssdEvidenceText, OPENCV_SSD_MOBILENET_V2_COCO_2026JUL);
  });

  it('keeps NanoDet technically verified only with its committed runtime smoke', () => {
    expectVerifiedEvidence(nanodetEvidenceText, OPENCV_NANODET_M_PLUS_1_5X_416);
  });
});
