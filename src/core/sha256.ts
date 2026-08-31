const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

function hex32(value: number): string {
  return (value >>> 0).toString(16).padStart(8, '0');
}

/**
 * Incremental SHA-256 implementation used where Web Crypto's one-shot digest
 * would require materializing an entire large local video in memory.
 */
export class IncrementalSha256 {
  private h0 = 0x6a09e667;
  private h1 = 0xbb67ae85;
  private h2 = 0x3c6ef372;
  private h3 = 0xa54ff53a;
  private h4 = 0x510e527f;
  private h5 = 0x9b05688c;
  private h6 = 0x1f83d9ab;
  private h7 = 0x5be0cd19;
  private readonly buffer = new Uint8Array(64);
  private bufferLength = 0;
  private bytesHashed = 0;
  private finished = false;
  private digestCache: string | null = null;

  update(data: Uint8Array): this {
    if (this.finished) throw new Error('SHA-256 hasher is already finalized');
    if (data.byteLength === 0) return this;
    this.bytesHashed += data.byteLength;
    if (!Number.isSafeInteger(this.bytesHashed)) {
      throw new Error('SHA-256 input length exceeds JavaScript safe integer range');
    }

    let offset = 0;
    if (this.bufferLength > 0) {
      const take = Math.min(64 - this.bufferLength, data.byteLength);
      this.buffer.set(data.subarray(0, take), this.bufferLength);
      this.bufferLength += take;
      offset += take;
      if (this.bufferLength === 64) {
        this.processBlock(this.buffer, 0);
        this.bufferLength = 0;
      }
    }

    while (offset + 64 <= data.byteLength) {
      this.processBlock(data, offset);
      offset += 64;
    }

    if (offset < data.byteLength) {
      const remainder = data.subarray(offset);
      this.buffer.set(remainder, 0);
      this.bufferLength = remainder.byteLength;
    }
    return this;
  }

  digestHex(): string {
    if (this.digestCache) return this.digestCache;
    if (!this.finished) this.finalize();
    const value = [
      this.h0, this.h1, this.h2, this.h3,
      this.h4, this.h5, this.h6, this.h7,
    ].map(hex32).join('');
    this.digestCache = value;
    return value;
  }

  private finalize(): void {
    const originalLengthBytes = this.bytesHashed;
    const pad = new Uint8Array(this.bufferLength < 56 ? 64 : 128);
    pad.set(this.buffer.subarray(0, this.bufferLength), 0);
    pad[this.bufferLength] = 0x80;

    const bitLength = originalLengthBytes * 8;
    const high = Math.floor(bitLength / 0x1_0000_0000);
    const low = bitLength >>> 0;
    const lengthOffset = pad.byteLength - 8;
    pad[lengthOffset] = (high >>> 24) & 0xff;
    pad[lengthOffset + 1] = (high >>> 16) & 0xff;
    pad[lengthOffset + 2] = (high >>> 8) & 0xff;
    pad[lengthOffset + 3] = high & 0xff;
    pad[lengthOffset + 4] = (low >>> 24) & 0xff;
    pad[lengthOffset + 5] = (low >>> 16) & 0xff;
    pad[lengthOffset + 6] = (low >>> 8) & 0xff;
    pad[lengthOffset + 7] = low & 0xff;

    for (let offset = 0; offset < pad.byteLength; offset += 64) {
      this.processBlock(pad, offset);
    }
    this.bufferLength = 0;
    this.finished = true;
  }

  private processBlock(data: Uint8Array, offset: number): void {
    const w = new Uint32Array(64);
    for (let i = 0; i < 16; i += 1) {
      const j = offset + i * 4;
      w[i] = (
        ((data[j] ?? 0) << 24)
        | ((data[j + 1] ?? 0) << 16)
        | ((data[j + 2] ?? 0) << 8)
        | (data[j + 3] ?? 0)
      ) >>> 0;
    }
    for (let i = 16; i < 64; i += 1) {
      const a = w[i - 15] ?? 0;
      const b = w[i - 2] ?? 0;
      const s0 = (rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)) >>> 0;
      const s1 = (rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10)) >>> 0;
      w[i] = ((w[i - 16] ?? 0) + s0 + (w[i - 7] ?? 0) + s1) >>> 0;
    }

    let a = this.h0;
    let b = this.h1;
    let c = this.h2;
    let d = this.h3;
    let e = this.h4;
    let f = this.h5;
    let g = this.h6;
    let h = this.h7;

    for (let i = 0; i < 64; i += 1) {
      const s1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const temp1 = (h + s1 + ch + (SHA256_K[i] ?? 0) + (w[i] ?? 0)) >>> 0;
      const s0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const temp2 = (s0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    this.h0 = (this.h0 + a) >>> 0;
    this.h1 = (this.h1 + b) >>> 0;
    this.h2 = (this.h2 + c) >>> 0;
    this.h3 = (this.h3 + d) >>> 0;
    this.h4 = (this.h4 + e) >>> 0;
    this.h5 = (this.h5 + f) >>> 0;
    this.h6 = (this.h6 + g) >>> 0;
    this.h7 = (this.h7 + h) >>> 0;
  }
}

export interface BlobHashProgress {
  processedBytes: number;
  totalBytes: number;
  ratio: number;
}

export interface BlobSha256Options {
  chunkSizeBytes?: number;
  onProgress?: (progress: BlobHashProgress) => void;
}

/** Hash a Blob/File in bounded memory. This is intentionally independent from
 * Web Crypto because SubtleCrypto.digest is one-shot and large videos should
 * not be copied into a single ArrayBuffer on reused phones.
 */
export async function sha256BlobHex(
  blob: Blob,
  options: BlobSha256Options = {},
): Promise<string> {
  const chunkSizeBytes = options.chunkSizeBytes ?? 4 * 1024 * 1024;
  if (!Number.isInteger(chunkSizeBytes) || chunkSizeBytes < 1024) {
    throw new Error('chunkSizeBytes must be an integer greater than or equal to 1024');
  }
  const hasher = new IncrementalSha256();
  let processedBytes = 0;

  while (processedBytes < blob.size) {
    const end = Math.min(blob.size, processedBytes + chunkSizeBytes);
    const chunk = new Uint8Array(await blob.slice(processedBytes, end).arrayBuffer());
    hasher.update(chunk);
    processedBytes = end;
    options.onProgress?.({
      processedBytes,
      totalBytes: blob.size,
      ratio: blob.size === 0 ? 1 : processedBytes / blob.size,
    });
  }
  if (blob.size === 0) {
    options.onProgress?.({ processedBytes: 0, totalBytes: 0, ratio: 1 });
  }
  return hasher.digestHex();
}
