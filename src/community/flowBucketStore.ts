import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { isValidNodeId } from '../backend/nodeCredential';
import type { EntityType } from '../core/types';
import type { CommunityDirection } from './protocol';

export interface CommunityFlowBucketCell {
  id: string;
  nodeId: string;
  streamId: string;
  bucketStartMs: number;
  bucketEndMs: number;
  entityType: EntityType;
  direction: CommunityDirection;
  count: number;
  qualitySum: number;
}

export interface CommunityFlowBucketDelta {
  nodeId: string;
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
  listStreams(nodeId: string): Promise<string[]>;
  listClosedBucketStarts(nodeId: string, streamId: string, nowMs: number): Promise<number[]>;
  listBucket(nodeId: string, streamId: string, bucketStartMs: number): Promise<CommunityFlowBucketCell[]>;
  deleteBucket(nodeId: string, streamId: string, bucketStartMs: number): Promise<void>;
}

interface Konta2rCommunityBucketSchema extends DBSchema {
  buckets: {
    key: string;
    value: CommunityFlowBucketCell;
    indexes: {
      'by-node-stream-bucket': [string, string, number];
    };
  };
}

const DB_NAME = 'Konta2rCommunityBucketsDB';
const DB_VERSION = 2;

export function communityFlowBucketCellId(
  nodeId: string,
  streamId: string,
  bucketStartMs: number,
  entityType: EntityType,
  direction: CommunityDirection,
): string {
  return [nodeId, streamId, bucketStartMs, entityType, direction].join('|');
}

function validateNode(nodeId: string): void {
  if (!isValidNodeId(nodeId)) throw new Error('Invalid Konta2r node id for Community bucket');
}

function validateDelta(delta: CommunityFlowBucketDelta): void {
  validateNode(delta.nodeId);
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
 * Buckets are identity-scoped so a reprovisioned phone cannot publish counters
 * observed under a previous node/segment identity.
 */
export class IndexedDbCommunityFlowBucketStore implements CommunityFlowBucketStore {
  private readonly dbPromise: Promise<IDBPDatabase<Konta2rCommunityBucketSchema>>;

  constructor(name = DB_NAME) {
    this.dbPromise = openDB<Konta2rCommunityBucketSchema>(name, DB_VERSION, {
      upgrade(db, oldVersion) {
        // v1 buckets were not bound to a node identity. They are intentionally
        // discarded rather than risking attribution to a later provisioned node.
        if (oldVersion < 2 && db.objectStoreNames.contains('buckets')) {
          db.deleteObjectStore('buckets');
        }
        if (!db.objectStoreNames.contains('buckets')) {
          const store = db.createObjectStore('buckets', { keyPath: 'id' });
          store.createIndex('by-node-stream-bucket', ['nodeId', 'streamId', 'bucketStartMs']);
        }
      },
    });
  }

  async add(delta: CommunityFlowBucketDelta): Promise<void> {
    validateDelta(delta);
    const id = communityFlowBucketCellId(
      delta.nodeId,
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
      nodeId: delta.nodeId,
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

  async listStreams(nodeId: string): Promise<string[]> {
    validateNode(nodeId);
    const db = await this.dbPromise;
    const range = IDBKeyRange.bound(
      [nodeId, '', 0],
      [nodeId, '\uffff', Number.MAX_SAFE_INTEGER],
    );
    const cells = await db.getAllFromIndex('buckets', 'by-node-stream-bucket', range);
    return [...new Set(cells.map((cell) => cell.streamId))].sort();
  }

  async listClosedBucketStarts(nodeId: string, streamId: string, nowMs: number): Promise<number[]> {
    validateNode(nodeId);
    if (!streamId.trim()) throw new Error('Community bucket streamId is required');
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new Error('Community bucket clock is invalid');
    const db = await this.dbPromise;
    const range = IDBKeyRange.bound([nodeId, streamId, 0], [nodeId, streamId, nowMs]);
    const cells = await db.getAllFromIndex('buckets', 'by-node-stream-bucket', range);
    return [...new Set(
      cells
        .filter((cell) => cell.bucketEndMs <= nowMs)
        .map((cell) => cell.bucketStartMs),
    )].sort((a, b) => a - b);
  }

  async listBucket(
    nodeId: string,
    streamId: string,
    bucketStartMs: number,
  ): Promise<CommunityFlowBucketCell[]> {
    validateNode(nodeId);
    const db = await this.dbPromise;
    return db.getAllFromIndex(
      'buckets',
      'by-node-stream-bucket',
      IDBKeyRange.only([nodeId, streamId, bucketStartMs]),
    );
  }

  async deleteBucket(nodeId: string, streamId: string, bucketStartMs: number): Promise<void> {
    validateNode(nodeId);
    const db = await this.dbPromise;
    const tx = db.transaction('buckets', 'readwrite');
    let cursor = await tx.store.index('by-node-stream-bucket').openCursor(
      IDBKeyRange.only([nodeId, streamId, bucketStartMs]),
    );
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
    await tx.done;
  }
}
