import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import {
  validateCountingGeometryConfiguration,
  type CountingGeometryConfiguration,
  type CountingGeometryStore,
} from './countingGeometry';

interface Konta2rCountingGeometrySchema extends DBSchema {
  geometry: {
    key: 'current';
    value: {
      key: 'current';
      configuration: CountingGeometryConfiguration;
    };
  };
}

const DB_NAME = 'Konta2rCountingGeometryDB';
const DB_VERSION = 1;

/**
 * Stores only normalized counting geometry and its version metadata. No camera
 * frame/image is persisted alongside the geometry.
 */
export class IndexedDbCountingGeometryStore implements CountingGeometryStore {
  private readonly dbPromise: Promise<IDBPDatabase<Konta2rCountingGeometrySchema>>;

  constructor(name = DB_NAME) {
    this.dbPromise = openDB<Konta2rCountingGeometrySchema>(name, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('geometry')) {
          db.createObjectStore('geometry', { keyPath: 'key' });
        }
      },
    });
  }

  async load(): Promise<CountingGeometryConfiguration | undefined> {
    const db = await this.dbPromise;
    const record = await db.get('geometry', 'current');
    if (!record) return undefined;
    validateCountingGeometryConfiguration(record.configuration);
    return structuredClone(record.configuration);
  }

  async save(configuration: CountingGeometryConfiguration): Promise<void> {
    validateCountingGeometryConfiguration(configuration);
    const db = await this.dbPromise;
    await db.put('geometry', {
      key: 'current',
      configuration: structuredClone(configuration),
    });
  }

  async clear(): Promise<void> {
    const db = await this.dbPromise;
    await db.delete('geometry', 'current');
  }
}
