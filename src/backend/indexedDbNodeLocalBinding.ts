import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import {
  validateLocalNodeBinding,
  type LocalNodeBinding,
  type NodeLocalBindingStore,
} from './nodeLocalBinding.ts';

interface Konta2rNodeConfigSchema extends DBSchema {
  binding: {
    key: string;
    value: LocalNodeBinding;
  };
}

const DB_NAME = 'Konta2rNodeConfigDB';
const DB_VERSION = 1;
const ACTIVE_BINDING_KEY = 'active-node';

/** Non-secret node/device metadata used only to restore local runtime context. */
export class IndexedDbNodeLocalBindingStore implements NodeLocalBindingStore {
  private readonly dbPromise: Promise<IDBPDatabase<Konta2rNodeConfigSchema>>;

  constructor(name = DB_NAME) {
    this.dbPromise = openDB<Konta2rNodeConfigSchema>(name, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('binding')) {
          db.createObjectStore('binding');
        }
      },
    });
  }

  async get(): Promise<LocalNodeBinding | undefined> {
    const db = await this.dbPromise;
    const binding = await db.get('binding', ACTIVE_BINDING_KEY);
    if (!binding) return undefined;
    try {
      validateLocalNodeBinding(binding);
      return binding;
    } catch {
      return undefined;
    }
  }

  async put(binding: LocalNodeBinding): Promise<void> {
    validateLocalNodeBinding(binding);
    const db = await this.dbPromise;
    await db.put('binding', binding, ACTIVE_BINDING_KEY);
  }

  async clear(): Promise<void> {
    const db = await this.dbPromise;
    await db.delete('binding', ACTIVE_BINDING_KEY);
  }
}
