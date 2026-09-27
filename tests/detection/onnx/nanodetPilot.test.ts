import { describe, expect, it } from 'vitest';
import { OPENCV_NANODET_M_PLUS_1_5X_416 } from '../../../src/detection/modelCandidates';
import type { VerifiedOnnxArtifactCache } from '../../../src/detection/onnx/artifactCache';
import { loadNanoDetPilot } from '../../../src/detection/onnx/nanodetPilot';
import type { VerifiedOnnxArtifact } from '../../../src/detection/onnx/modelArtifact';

class MemoryArtifactCache implements VerifiedOnnxArtifactCache {
  artifact: VerifiedOnnxArtifact | undefined;
  puts = 0;
  deletes = 0;
  failPut = false;

  async get(_expectedSha256: string): Promise<VerifiedOnnxArtifact | undefined> {
    return this.artifact;
  }

  async put(artifact: VerifiedOnnxArtifact, _sourceUrl: string): Promise<void> {
    this.puts += 1;
    if (this.failPut) throw new Error('quota');
    this.artifact = artifact;
  }

  async delete(_sha256: string): Promise<void> {
    this.deletes += 1;
    this.artifact = undefined;
  }
}

function cachedArtifact(): VerifiedOnnxArtifact {
  return {
    bytes: new Uint8Array([1, 2, 3, 4]),
    sha256: OPENCV_NANODET_M_PLUS_1_5X_416.artifact.sha256,
    sizeBytes: 4,
  };
}

describe('NanoDet field-pilot loader', () => {
  it('uses an already verified cache hit without touching the network', async () => {
    const cache = new MemoryArtifactCache();
    cache.artifact = cachedArtifact();
    let fetches = 0;

    const loaded = await loadNanoDetPilot({
      cache,
      fetcher: async () => {
        fetches += 1;
        throw new Error('network should not be used');
      },
    });

    expect(fetches).toBe(0);
    expect(loaded.artifactSource).toBe('cache');
    expect(loaded.cachePersisted).toBe(true);
    expect(loaded.modelSha256).toBe(OPENCV_NANODET_M_PLUS_1_5X_416.artifact.sha256);
    expect(loaded.redistributionVerified).toBe(false);
    await loaded.detector.dispose();
  });

  it('downloads, verifies and caches the registered external artifact on a miss', async () => {
    const cache = new MemoryArtifactCache();
    const bytes = new Uint8Array([7, 8, 9, 10]);
    let requested = '';

    const loaded = await loadNanoDetPilot({
      cache,
      fetcher: async (input) => {
        requested = String(input);
        return new Response(bytes, { status: 200 });
      },
      digest: async () => OPENCV_NANODET_M_PLUS_1_5X_416.artifact.sha256,
    });

    expect(requested).toBe(OPENCV_NANODET_M_PLUS_1_5X_416.artifact.url);
    expect(loaded.artifactSource).toBe('network');
    expect(loaded.cachePersisted).toBe(true);
    expect(cache.puts).toBe(1);
    expect(cache.artifact?.bytes).toEqual(bytes);
    await loaded.detector.dispose();
  });

  it('can execute a verified in-memory artifact even when persistent caching fails', async () => {
    const cache = new MemoryArtifactCache();
    cache.failPut = true;

    const loaded = await loadNanoDetPilot({
      cache,
      fetcher: async () => new Response(new Uint8Array([5, 6, 7]), { status: 200 }),
      digest: async () => OPENCV_NANODET_M_PLUS_1_5X_416.artifact.sha256,
    });

    expect(loaded.artifactSource).toBe('network');
    expect(loaded.cachePersisted).toBe(false);
    expect(cache.puts).toBe(1);
    expect(loaded.redistributionVerified).toBe(false);
    await loaded.detector.dispose();
  });
});
