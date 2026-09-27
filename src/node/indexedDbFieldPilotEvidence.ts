import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  FieldPilotEvidenceStore,
  FieldPilotRuntimeSample,
  FieldPilotSessionRecord,
} from './fieldPilotEvidence';

interface Konta2rFieldPilotSchema extends DBSchema {
  sessions: {
    key: string;
    value: FieldPilotSessionRecord;
    indexes: {
      'by-status': FieldPilotSessionRecord['status'];
    };
  };
  samples: {
    key: string;
    value: FieldPilotRuntimeSample;
    indexes: {
      'by-session': string;
    };
  };
}

const DB_NAME = 'Konta2rFieldPilotDB';
const DB_VERSION = 1;

/**
 * Durable, local-only performance evidence for field pilots. No camera frame,
 * detection box, track identifier, Community identity or credential is part of
 * this schema.
 */
export class IndexedDbFieldPilotEvidenceStore implements FieldPilotEvidenceStore {
  private readonly dbPromise: Promise<IDBPDatabase<Konta2rFieldPilotSchema>>;

  constructor(name = DB_NAME) {
    this.dbPromise = openDB<Konta2rFieldPilotSchema>(name, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('sessions')) {
          const sessions = db.createObjectStore('sessions', { keyPath: 'sessionId' });
          sessions.createIndex('by-status', 'status');
        }
        if (!db.objectStoreNames.contains('samples')) {
          const samples = db.createObjectStore('samples', { keyPath: 'id' });
          samples.createIndex('by-session', 'sessionId');
        }
      },
    });
  }

  async putSession(session: FieldPilotSessionRecord): Promise<void> {
    const db = await this.dbPromise;
    await db.put('sessions', structuredClone(session));
  }

  async getSession(sessionId: string): Promise<FieldPilotSessionRecord | undefined> {
    const db = await this.dbPromise;
    const session = await db.get('sessions', sessionId);
    return session ? structuredClone(session) : undefined;
  }

  async listSessions(limit = 20): Promise<FieldPilotSessionRecord[]> {
    const db = await this.dbPromise;
    const sessions = await db.getAll('sessions');
    return sessions
      .sort((a, b) => Date.parse(b.startedAtIso) - Date.parse(a.startedAtIso))
      .slice(0, Math.max(1, Math.floor(limit)))
      .map((session) => structuredClone(session));
  }

  async putSample(sample: FieldPilotRuntimeSample): Promise<void> {
    const db = await this.dbPromise;
    await db.put('samples', structuredClone(sample));
  }

  async listSamples(sessionId: string): Promise<FieldPilotRuntimeSample[]> {
    const db = await this.dbPromise;
    const samples = await db.getAllFromIndex('samples', 'by-session', sessionId);
    return samples
      .sort((a, b) => a.sequence - b.sequence)
      .map((sample) => structuredClone(sample));
  }

  async deleteSession(sessionId: string): Promise<void> {
    const db = await this.dbPromise;
    const transaction = db.transaction(['sessions', 'samples'], 'readwrite');
    await transaction.objectStore('sessions').delete(sessionId);
    const sampleStore = transaction.objectStore('samples');
    const keys = await sampleStore.index('by-session').getAllKeys(sessionId);
    for (const key of keys) await sampleStore.delete(key);
    await transaction.done;
  }
}
