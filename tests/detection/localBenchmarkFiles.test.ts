import { describe, expect, it } from 'vitest';
import {
  hashLocalBenchmarkBlob,
  verifiedOnnxArtifactFromLocalBlob,
} from '../../src/detection/localBenchmarkFiles';

function blobFromText(text: string): Blob {
  const encoded = new TextEncoder().encode(text);
  const buffer = new ArrayBuffer(encoded.byteLength);
  new Uint8Array(buffer).set(encoded);
  return new Blob([buffer]);
}

describe('local benchmark files', () => {
  it('hashes a local Blob with the incremental SHA-256 path', async () => {
    await expect(hashLocalBenchmarkBlob(blobFromText('abc')))
      .resolves.toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('materializes ONNX bytes only after the expected hash matches', async () => {
    const artifact = await verifiedOnnxArtifactFromLocalBlob(
      blobFromText('abc'),
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(artifact.sha256).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(artifact.sizeBytes).toBe(3);
    expect([...artifact.bytes]).toEqual([97, 98, 99]);
  });

  it('rejects a local model whose bytes do not match the registered hash', async () => {
    await expect(verifiedOnnxArtifactFromLocalBlob(blobFromText('abc'), '0'.repeat(64)))
      .rejects.toThrow('SHA-256 mismatch');
  });
});
