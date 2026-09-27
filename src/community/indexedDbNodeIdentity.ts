import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { LocalNodeIdentity, NodeIdentityStore } from './nodeProvisioning';

interface Konta2rNodeIdentitySchema extends DBSchema {
  identity: {
    key: string;
    value: LocalNodeIdentity;
  };
}

const DB_NAME = 'Konta2rNodeIdentityDB';
const DB_VERSION = 1;
const CURRENT_IDENTITY_KEY = 'current';

/**
 * Persists the sensor credential only on the device that operates the node.
 * The credential is never written to the Konta2r backend. Browser origin
 * security and a strict CSP remain required because same-origin script can read
 * IndexedDB; this store is persistence, not an XSS security boundary.
 */
export class IndexedDbNodeIdentityStore implements NodeIdentityStore {
  private readonly dbPromise: Promise<IDBPDatabase<Konta2rNodeIdentitySchema>>;

  constructor(name = DB_NAME) {
    this.dbPromise = openDB<Konta2rNodeIdentitySchema>(name, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('identity')) {
          db.createObjectStore('identity');
        }
      },
    });
  }

  async get(): Promise<LocalNodeIdentity | undefined> {
    const db = await this.dbPromise;
    return db.get('identity', CURRENT_IDENTITY_KEY);
  }

  async put(identity: LocalNodeIdentity): Promise<void> {
    const db = await this.dbPromise;
    await db.put('identity', identity, CURRENT_IDENTITY_KEY);
  }

  async clear(): Promise<void> {
    const db = await this.dbPromise;
    await db.delete('identity', CURRENT_IDENTITY_KEY);
  }
}
