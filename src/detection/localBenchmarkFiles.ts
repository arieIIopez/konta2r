import { sha256BlobHex, type BlobHashProgress } from '../core/sha256';
import type { VerifiedOnnxArtifact } from './onnx/modelArtifact';

export interface LocalFileHashOptions {
  chunkSizeBytes?: number;
  onProgress?: (progress: BlobHashProgress) => void;
}

function normalizeSha256(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new Error('Expected SHA-256 must contain exactly 64 hexadecimal characters');
  }
  return normalized;
}

/**
 * Hash a local file in bounded memory and only materialize the complete ONNX
 * ArrayBuffer after its identity matches the registered checkpoint hash.
 */
export async function verifiedOnnxArtifactFromLocalBlob(
  blob: Blob,
  expectedSha256: string,
  options: LocalFileHashOptions = {},
): Promise<VerifiedOnnxArtifact> {
  if (blob.size <= 0) throw new Error('Local ONNX artifact is empty');
  const expected = normalizeSha256(expectedSha256);
  const actual = await sha256BlobHex(blob, options);
  if (actual !== expected) {
    throw new Error(`Local ONNX artifact SHA-256 mismatch: expected ${expected}, received ${actual}`);
  }

  const buffer = await blob.arrayBuffer();
  if (buffer.byteLength !== blob.size) {
    throw new Error('Local ONNX artifact byte length changed while it was being prepared');
  }
  return {
    bytes: new Uint8Array(buffer),
    sha256: actual,
    sizeBytes: buffer.byteLength,
  };
}

export async function hashLocalBenchmarkBlob(
  blob: Blob,
  options: LocalFileHashOptions = {},
): Promise<string> {
  return sha256BlobHex(blob, options);
}
