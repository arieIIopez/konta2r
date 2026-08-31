export interface VerifiedOnnxArtifact {
  bytes: Uint8Array;
  sha256: string;
  sizeBytes: number;
}

export type ArtifactFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type Sha256Digest = (bytes: Uint8Array) => Promise<string>;

function normalizeSha256(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new Error('Expected SHA-256 must contain exactly 64 hexadecimal characters');
  }
  return normalized;
}

function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto SubtleCrypto is required to verify ONNX artifacts');
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', copyToArrayBuffer(bytes));
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Fetches a model as bytes and verifies its content identity before ONNX Runtime
 * sees it. A remote URL is therefore not treated as sufficient evidence of
 * which checkpoint was executed.
 */
export async function fetchVerifiedOnnxArtifact(
  url: string,
  expectedSha256: string,
  options: {
    fetcher?: ArtifactFetcher;
    digest?: Sha256Digest;
  } = {},
): Promise<VerifiedOnnxArtifact> {
  const expected = normalizeSha256(expectedSha256);
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
  const digest = options.digest ?? sha256Hex;
  const response = await fetcher(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`ONNX artifact download failed with HTTP ${response.status}`);
  }

  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (bytes.byteLength === 0) throw new Error('ONNX artifact is empty');
  const actualSha256 = (await digest(bytes)).toLowerCase();
  if (actualSha256 !== expected) {
    throw new Error(`ONNX artifact SHA-256 mismatch: expected ${expected}, received ${actualSha256}`);
  }

  return {
    bytes,
    sha256: actualSha256,
    sizeBytes: bytes.byteLength,
  };
}
