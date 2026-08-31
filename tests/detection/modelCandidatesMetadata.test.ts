import { describe, expect, it } from 'vitest';
import {
  DETECTOR_CANDIDATES,
  OPENCV_NANODET_M_PLUS_1_5X_416,
} from '../../src/detection/modelCandidates';

describe('detector candidate metadata', () => {
  it('registers NanoDet as a probe-pending eco candidate with exact LFS identity', () => {
    expect(OPENCV_NANODET_M_PLUS_1_5X_416).toMatchObject({
      role: 'eco_candidate',
      status: 'probe_pending',
      codecId: undefined,
      inputHint: { width: 416, height: 416, layout: 'NCHW' },
      artifact: {
        sha256: '4b82da9944b88577175ee23a459dce2e26e6e4be573def65b1055dc2d9720186',
        redistributionVerified: false,
      },
    });
    expect(OPENCV_NANODET_M_PLUS_1_5X_416.artifact.approximateSizeMb).toBeLessThan(4);
  });

  it('keeps candidate ids unique', () => {
    const ids = DETECTOR_CANDIDATES.map((candidate) => candidate.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
