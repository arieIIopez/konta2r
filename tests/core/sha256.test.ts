import { describe, expect, it } from 'vitest';
import { IncrementalSha256, sha256BlobHex } from '../../src/core/sha256';

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe('incremental SHA-256', () => {
  it('matches the standard empty-message vector', () => {
    expect(new IncrementalSha256().digestHex())
      .toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('matches the standard abc vector', () => {
    expect(new IncrementalSha256().update(bytes('abc')).digestHex())
      .toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('matches a multi-block standard sentence', () => {
    expect(new IncrementalSha256().update(bytes('The quick brown fox jumps over the lazy dog')).digestHex())
      .toBe('d7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592');
  });

  it('is invariant to arbitrary update chunk boundaries', () => {
    const text = 'Konta2r '.repeat(1000);
    const all = bytes(text);
    const oneShot = new IncrementalSha256().update(all).digestHex();
    const incremental = new IncrementalSha256();
    let offset = 0;
    const pattern = [1, 7, 63, 64, 65, 3, 129];
    let patternIndex = 0;
    while (offset < all.length) {
      const size = pattern[patternIndex % pattern.length] ?? 1;
      incremental.update(all.subarray(offset, Math.min(all.length, offset + size)));
      offset += size;
      patternIndex += 1;
    }
    expect(incremental.digestHex()).toBe(oneShot);
  });

  it('matches the one-million-a published vector', () => {
    const hasher = new IncrementalSha256();
    const block = bytes('a'.repeat(10_000));
    for (let i = 0; i < 100; i += 1) hasher.update(block);
    expect(hasher.digestHex())
      .toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
  });

  it('hashes Blob content in bounded chunks and reports monotonic progress', async () => {
    const content = bytes('abc'.repeat(1000));
    const blobBuffer = new ArrayBuffer(content.byteLength);
    new Uint8Array(blobBuffer).set(content);
    const progress: number[] = [];
    const digest = await sha256BlobHex(new Blob([blobBuffer]), {
      chunkSizeBytes: 1024,
      onProgress: (value) => progress.push(value.processedBytes),
    });
    const expected = new IncrementalSha256().update(content).digestHex();
    expect(digest).toBe(expected);
    expect(progress.length).toBeGreaterThan(1);
    expect(progress.at(-1)).toBe(content.byteLength);
    expect(progress.every((value, index) => index === 0 || value >= (progress[index - 1] ?? 0))).toBe(true);
  });

  it('reports completion for an empty Blob', async () => {
    const progress: Array<{ processedBytes: number; totalBytes: number; ratio: number }> = [];
    const digest = await sha256BlobHex(new Blob([]), {
      onProgress: (value) => progress.push(value),
    });
    expect(digest).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(progress).toEqual([{ processedBytes: 0, totalBytes: 0, ratio: 1 }]);
  });
});