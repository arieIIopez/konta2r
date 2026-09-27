import { describe, expect, it } from 'vitest';
import evidenceText from '../../../docs/benchmarks/evidence/opencv-nanodet-m-plus-1.5x-416-2022nov-probe.json?raw';
import { OPENCV_NANODET_M_PLUS_1_5X_416 } from '../../../src/detection/modelCandidates';
import { reviewImportedProbeDiagnostic } from '../../../src/detection/onnx/probeDiagnosticReview';

describe('committed OpenCV NanoDet probe evidence', () => {
  it('remains technically verified against the current registry and codec gate', () => {
    const review = reviewImportedProbeDiagnostic(evidenceText);
    expect(review.candidate.id).toBe(OPENCV_NANODET_M_PLUS_1_5X_416.id);
    expect(review.candidate.status).toBe('probe_verified');
    expect(review.candidate.codecId).toBe('nanodet_plus_gfl');
    expect(review.verification.status).toBe('verified');
    expect(review.verification.findings).toEqual([]);
    expect(review.diagnostic.probe.runtimeSmoke?.passed).toBe(true);
    expect(review.diagnostic.probe.inputs[0]?.shape).toEqual([1, 3, 416, 416]);
    expect(review.diagnostic.probe.outputs).toHaveLength(6);
    expect(review.diagnostic.probe.artifact.sha256).toBe(OPENCV_NANODET_M_PLUS_1_5X_416.artifact.sha256);
  });
});
