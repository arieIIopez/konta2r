import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { EntityType } from '../core/types';
import type { CommunityDirection } from './protocol';

export interface CommunityFlowBucketCell {
  id: string;
  streamId: string;
  bucketStartMs: number;
  bucketEndMs: number;
  entityType: EntityType;
  direction: CommunityDirection;
  count: number;
  qualitySum: number;
}

export interface CommunityFlowBucketDelta {
  streamId: string;
  bucketStartMs: number;
  bucketEndMs: number;
  entityType: EntityType;
  direction: CommunityDirection;
  count: number;
  qualitySum: number;
}

export interface CommunityFlowBucketStore {
  add(delta: CommunityFlowBucketDelta): Promise<void>;
  listClosedBucketStarts(streamId: string, nowMs: number): Promise<number[]>;
  listBucket(streamId: string, bucketStartMs: number): Promise<CommunityFlowBucketCell[]>;
  deleteBucket(streamId: string, bucketStartMs: number): Promise<void>;
}

interface Konta2rCommunityBucketSchema extends DBSchema {
  buckets: {
    key: string;
    value: CommunityFlowBucketCell;
    indexes: {
      'by-stream-bucket': [string, number];
    };
  };
}

const DB_NAME = 'Konta2rCommunityBucketsDB';
const DB_VERSION = 1;

export function communityFlowBucketCellId(
  streamId: string,
  bucketStartMs: number,
  entityType: EntityType,
  direction: CommunityDirection,
): string {
  return [streamId, bucketStartMs, entityType, direction].join('|');
}

function validateDelta(delta: CommunityFlowBucketDelta): void {
  if (!delta.streamId.trim()) throw new Error('Community bucket streamId is required');
  if (!Number.isSafeInteger(delta.bucketStartMs) || delta.bucketStartMs < 0) {
    throw new Error('Community bucket start must be a non-negative integer');
  }
  if (!Number.isSafeInteger(delta.bucketEndMs) || delta.bucketEndMs <= delta.bucketStartMs) {
    throw new Error('Community bucket end must be greater than start');
  }
  if (!Number.isSafeInteger(delta.count) || delta.count <= 0) {
    throw new Error('Community bucket delta count must be a positive integer');
  }
  if (!Number.isFinite(delta.qualitySum) || delta.qualitySum < 0 || delta.qualitySum > delta.count) {
    throw new Error('Community bucket quality sum is invalid');
  }
}

/**
 * Persists only already-reduced counters. No track/event id, exact crossing
 * timestamp, pixel coordinate or frame data is written to this database.
 */
export class IndexedDbCommunityFlowBucketStore implements CommunityFlowBucketStore {
  private readonly dbPromise: Promise<IDBPDatabase<Konta2rCommunityBucketSchema>>;

  constructor(name = DB_NAME) {
    this.dbPromise = openDB<Konta2rCommunityBucketSchema>(name, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('buckets')) {
          const store = db.createObjectStore('buckets', { keyPath: 'id' });
          store.createIndex('by-stream-bucket', ['streamId', 'bucketStartMs']);
        }
      },
    });
  }

  async add(delta: CommunityFlowBucketDelta): Promise<void> {
    validateDelta(delta);
    const id = communityFlowBucketCellId(
      delta.streamId,
      delta.bucketStartMs,
      delta.entityType,
      delta.direction,
    );
    const db = await this.dbPromise;
    const tx = db.transaction('buckets', 'readwrite');
    const existing = await tx.store.get(id);
    await tx.store.put({
      id,
      streamId: delta.streamId,
      bucketStartMs: delta.bucketStartMs,
      bucketEndMs: delta.bucketEndMs,
      entityType: delta.entityType,
      direction: delta.direction,
      count: (existing?.count ?? 0) + delta.count,
      qualitySum: (existing?.qualitySum ?? 0) + delta.qualitySum,
    });
    await tx.done;
  }

  async listClosedBucketStarts(streamId: string, nowMs: number): Promise<number[]> {
    if (!streamId.trim()) throw new Error('Community bucket streamId is required');
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new Error('Community bucket clock is invalid');
    const db = await this.dbPromise;
    const range = IDBKeyRange.bound([streamId, 0], [streamId, nowMs]);
    const cells = await db.getAllFromIndex('buckets', 'by-stream-bucket', range);
    return [...new Set(
      cells
        .filter((cell) => cell.bucketEndMs <= nowMs)
        .map((cell) => cell.bucketStartMs),
    )].sort((a, b) => a - b);
  }

  async listBucket(streamId: string, bucketStartMs: number): Promise<CommunityFlowBucketCell[]> {
    const db = await this.dbPromise;
    return db.getAllFromIndex(
      'buckets',
      'by-stream-bucket',
      IDBKeyRange.only([streamId, bucketStartMs]),
    );
  }

  async deleteBucket(streamId: string, bucketStartMs: number): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction('buckets', 'readwrite');
    let cursor = await tx.store.index('by-stream-bucket').openCursor(
      IDBKeyRange.only([streamId, bucketStartMs]),
    );
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
    await tx.done;
  }
}
