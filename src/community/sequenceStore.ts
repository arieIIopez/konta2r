import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { isValidNodeId } from '../backend/nodeCredential';

export interface CommunitySequenceStore {
  next(nodeId: string): Promise<number>;
  peek(nodeId: string): Promise<number | undefined>;
}

interface SequenceRecord {
  nodeId: string;
  nextSequence: number;
}

interface Konta2rCommunitySequenceSchema extends DBSchema {
  sequence: {
    key: string;
    value: SequenceRecord;
  };
}

const DB_NAME = 'Konta2rCommunitySequenceDB';
const DB_VERSION = 1;

/**
 * Allocates monotonically increasing per-node batch sequences. Allocation is
 * committed before a batch is enqueued: a crash may create a harmless gap, but
 * it cannot reuse a sequence that may already have reached the backend.
 */
export class IndexedDbCommunitySequenceStore implements CommunitySequenceStore {
  private readonly dbPromise: Promise<IDBPDatabase<Konta2rCommunitySequenceSchema>>;

  constructor(name = DB_NAME) {
    this.dbPromise = openDB<Konta2rCommunitySequenceSchema>(name, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('sequence')) db.createObjectStore('sequence');
      },
    });
  }

  async next(nodeId: string): Promise<number> {
    if (!isValidNodeId(nodeId)) throw new Error('Invalid Konta2r node id');
    const db = await this.dbPromise;
    const tx = db.transaction('sequence', 'readwrite');
    const current = await tx.store.get(nodeId);
    const sequence = current?.nextSequence ?? 0;
    if (!Number.isSafeInteger(sequence) || sequence < 0) {
      tx.abort();
      throw new Error('Invalid persisted Community sequence');
    }
    await tx.store.put({ nodeId, nextSequence: sequence + 1 }, nodeId);
    await tx.done;
    return sequence;
  }

  async peek(nodeId: string): Promise<number | undefined> {
    if (!isValidNodeId(nodeId)) throw new Error('Invalid Konta2r node id');
    const db = await this.dbPromise;
    return (await db.get('sequence', nodeId))?.nextSequence;
  }
}
