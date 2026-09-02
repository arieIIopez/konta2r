import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { VerifiedOnnxArtifact } from './modelArtifact';
import { sha256ArrayBufferHex } from './modelArtifact';

export interface VerifiedOnnxArtifactCache {
  get(expectedSha256: string): Promise<VerifiedOnnxArtifact | undefined>;
  put(artifact: VerifiedOnnxArtifact, sourceUrl: string): Promise<void>;
  delete(sha256: string): Promise<void>;
}

interface CachedOnnxArtifactRecord {
  sha256: string;
  sizeBytes: number;
  sourceUrl: string;
  cachedAtIso: string;
  bytes: ArrayBuffer;
}

interface Konta2rOnnxArtifactCacheSchema extends DBSchema {
  artifacts: {
    key: string;
    value: CachedOnnxArtifactRecord;
  };
}

const DB_NAME = 'Konta2rOnnxArtifactCacheDB';
const DB_VERSION = 1;

function normalizedSha(value: string): string {
  const sha = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha)) throw new Error('Invalid ONNX artifact SHA-256');
  return sha;
}

function copyBytes(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

/**
 * Cache for externally downloaded experimental checkpoints. A cache hit is
 * re-hashed before ONNX Runtime receives it, so IndexedDB persistence is not
 * treated as proof of artifact identity.
 */
export class IndexedDbVerifiedOnnxArtifactCache implements VerifiedOnnxArtifactCache {
  private readonly dbPromise: Promise<IDBPDatabase<Konta2rOnnxArtifactCacheSchema>>;

  constructor(name = DB_NAME) {
    this.dbPromise = openDB<Konta2rOnnxArtifactCacheSchema>(name, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('artifacts')) {
          db.createObjectStore('artifacts', { keyPath: 'sha256' });
        }
      },
    });
  }

  async get(expectedSha256: string): Promise<VerifiedOnnxArtifact | undefined> {
    const sha256 = normalizedSha(expectedSha256);
    const db = await this.dbPromise;
    const record = await db.get('artifacts', sha256);
    if (!record) return undefined;

    if (record.sizeBytes <= 0 || record.bytes.byteLength !== record.sizeBytes) {
      await db.delete('artifacts', sha256);
      return undefined;
    }
    const actual = await sha256ArrayBufferHex(record.bytes);
    if (actual.toLowerCase() !== sha256) {
      await db.delete('artifacts', sha256);
      return undefined;
    }
    return {
      bytes: new Uint8Array(record.bytes),
      sha256,
      sizeBytes: record.sizeBytes,
    };
  }

  async put(artifact: VerifiedOnnxArtifact, sourceUrl: string): Promise<void> {
    const sha256 = normalizedSha(artifact.sha256);
    if (artifact.sizeBytes <= 0 || artifact.bytes.byteLength !== artifact.sizeBytes) {
      throw new Error('Invalid verified ONNX artifact for cache');
    }
    const db = await this.dbPromise;
    await db.put('artifacts', {
      sha256,
      sizeBytes: artifact.sizeBytes,
      sourceUrl,
      cachedAtIso: new Date().toISOString(),
      bytes: copyBytes(artifact.bytes),
    });
  }

  async delete(sha256: string): Promise<void> {
    const db = await this.dbPromise;
    await db.delete('artifacts', normalizedSha(sha256));
  }
}
