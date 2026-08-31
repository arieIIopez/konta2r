import { describe, expect, it } from 'vitest';
import {
  fetchVerifiedOnnxArtifact,
  sha256Hex,
} from '../../../src/detection/onnx/modelArtifact';

const ABC_SHA256 = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

describe('ONNX model artifact verification', () => {
  it('computes a standard SHA-256 digest using Web Crypto', async () => {
    const bytes = new TextEncoder().encode('abc');
    expect(await sha256Hex(bytes)).toBe(ABC_SHA256);
  });

  it('returns bytes only when the downloaded content matches the registered hash', async () => {
    const bytes = new TextEncoder().encode('abc');
    const result = await fetchVerifiedOnnxArtifact('https://example.test/model.onnx', ABC_SHA256, {
      fetcher: async () => new Response(bytes, { status: 200 }),
    });

    expect(result.sha256).toBe(ABC_SHA256);
    expect(result.sizeBytes).toBe(3);
    expect([...result.bytes]).toEqual([...bytes]);
  });

  it('passes the downloaded ArrayBuffer directly to the digest boundary', async () => {
    const sourceBuffer = new ArrayBuffer(4);
    new Uint8Array(sourceBuffer).set([1, 2, 3, 4]);
    let received: ArrayBuffer | null = null;

    const result = await fetchVerifiedOnnxArtifact('https://example.test/model.onnx', ABC_SHA256, {
      fetcher: async () => new Response(sourceBuffer, { status: 200 }),
      digest: async (buffer) => {
        received = buffer;
        return ABC_SHA256;
      },
    });

    expect(received).toBeInstanceOf(ArrayBuffer);
    expect(received?.byteLength).toBe(4);
    expect(result.sizeBytes).toBe(4);
  });

  it('rejects a model whose bytes do not match the registered checkpoint hash', async () => {
    const bytes = new TextEncoder().encode('tampered');
    await expect(fetchVerifiedOnnxArtifact('https://example.test/model.onnx', ABC_SHA256, {
      fetcher: async () => new Response(bytes, { status: 200 }),
    })).rejects.toThrow('SHA-256 mismatch');
  });

  it('rejects invalid expected hashes before downloading', async () => {
    let requested = false;
    await expect(fetchVerifiedOnnxArtifact('https://example.test/model.onnx', 'not-a-hash', {
      fetcher: async () => {
        requested = true;
        return new Response('x');
      },
    })).rejects.toThrow('exactly 64 hexadecimal');
    expect(requested).toBe(false);
  });
});
