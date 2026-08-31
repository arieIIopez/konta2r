import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  CommunityOutboxItem,
  CommunityOutboxStore,
  OutboxStatus,
} from './outbox';

interface Konta2rCommunitySchema extends DBSchema {
  outbox: {
    key: string;
    value: CommunityOutboxItem;
    indexes: {
      'by-next-attempt': number;
      'by-status': OutboxStatus;
    };
  };
}

const DB_NAME = 'Konta2rCommunityDB';
const DB_VERSION = 1;

export class IndexedDbCommunityOutboxStore implements CommunityOutboxStore {
  private readonly dbPromise: Promise<IDBPDatabase<Konta2rCommunitySchema>>;

  constructor(name = DB_NAME) {
    this.dbPromise = openDB<Konta2rCommunitySchema>(name, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('outbox')) {
          const store = db.createObjectStore('outbox', { keyPath: 'id' });
          store.createIndex('by-next-attempt', 'nextAttemptAtMs');
          store.createIndex('by-status', 'status');
        }
      },
    });
  }

  async put(item: CommunityOutboxItem): Promise<void> {
    const db = await this.dbPromise;
    await db.put('outbox', item);
  }

  async get(id: string): Promise<CommunityOutboxItem | undefined> {
    const db = await this.dbPromise;
    return db.get('outbox', id);
  }

  async getDue(nowMs: number, limit: number): Promise<CommunityOutboxItem[]> {
    const db = await this.dbPromise;
    const range = IDBKeyRange.upperBound(nowMs);
    const candidates = await db.getAllFromIndex(
      'outbox',
      'by-next-attempt',
      range,
      Math.max(limit * 3, limit),
    );
    return candidates
      .filter((item) => item.status === 'pending')
      .sort((a, b) => a.nextAttemptAtMs - b.nextAttemptAtMs || a.sequence - b.sequence)
      .slice(0, limit);
  }

  async delete(id: string): Promise<void> {
    const db = await this.dbPromise;
    await db.delete('outbox', id);
  }

  async count(status?: OutboxStatus): Promise<number> {
    const db = await this.dbPromise;
    if (status === undefined) return db.count('outbox');
    return db.countFromIndex('outbox', 'by-status', status);
  }
}
