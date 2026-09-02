import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { isValidNodeId } from '../backend/nodeCredential';

export interface CommunitySequenceStore {
  next(nodeId: string): Promise<number>;
  reserve(nodeId: string, publicationKey: string): Promise<number>;
  release(nodeId: string, publicationKey: string): Promise<void>;
  peek(nodeId: string): Promise<number | undefined>;
}

interface SequenceRecord {
  nodeId: string;
  nextSequence: number;
}

interface SequenceReservation {
  id: string;
  nodeId: string;
  publicationKey: string;
  sequence: number;
}

interface Konta2rCommunitySequenceSchema extends DBSchema {
  sequence: {
    key: string;
    value: SequenceRecord;
  };
  reservations: {
    key: string;
    value: SequenceReservation;
  };
}

const DB_NAME = 'Konta2rCommunitySequenceDB';
const DB_VERSION = 2;

function validateNodeId(nodeId: string): void {
  if (!isValidNodeId(nodeId)) throw new Error('Invalid Konta2r node id');
}

function validatePublicationKey(publicationKey: string): string {
  const key = publicationKey.trim();
  if (!key || key.length > 240) throw new Error('Invalid Community publication key');
  return key;
}

function reservationId(nodeId: string, publicationKey: string): string {
  return `${nodeId}|${validatePublicationKey(publicationKey)}`;
}

function validateSequence(sequence: number): void {
  if (!Number.isSafeInteger(sequence) || sequence < 0) {
    throw new Error('Invalid persisted Community sequence');
  }
}

/**
 * Allocates monotonically increasing per-node batch sequences. `reserve()` adds
 * a local publication idempotency key: retrying the same closed bucket after a
 * crash reuses its original sequence rather than creating a duplicate upload.
 * The reservation is released only after the reduced source bucket is deleted.
 */
export class IndexedDbCommunitySequenceStore implements CommunitySequenceStore {
  private readonly dbPromise: Promise<IDBPDatabase<Konta2rCommunitySequenceSchema>>;

  constructor(name = DB_NAME) {
    this.dbPromise = openDB<Konta2rCommunitySequenceSchema>(name, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('sequence')) db.createObjectStore('sequence');
        if (!db.objectStoreNames.contains('reservations')) db.createObjectStore('reservations');
      },
    });
  }

  async next(nodeId: string): Promise<number> {
    validateNodeId(nodeId);
    const db = await this.dbPromise;
    const tx = db.transaction('sequence', 'readwrite');
    const current = await tx.store.get(nodeId);
    const sequence = current?.nextSequence ?? 0;
    validateSequence(sequence);
    await tx.store.put({ nodeId, nextSequence: sequence + 1 }, nodeId);
    await tx.done;
    return sequence;
  }

  async reserve(nodeId: string, publicationKey: string): Promise<number> {
    validateNodeId(nodeId);
    const key = validatePublicationKey(publicationKey);
    const id = reservationId(nodeId, key);
    const db = await this.dbPromise;
    const tx = db.transaction(['sequence', 'reservations'], 'readwrite');
    const reservations = tx.objectStore('reservations');
    const existing = await reservations.get(id);
    if (existing) {
      validateSequence(existing.sequence);
      await tx.done;
      return existing.sequence;
    }

    const sequences = tx.objectStore('sequence');
    const current = await sequences.get(nodeId);
    const sequence = current?.nextSequence ?? 0;
    validateSequence(sequence);
    await sequences.put({ nodeId, nextSequence: sequence + 1 }, nodeId);
    await reservations.put({
      id,
      nodeId,
      publicationKey: key,
      sequence,
    }, id);
    await tx.done;
    return sequence;
  }

  async release(nodeId: string, publicationKey: string): Promise<void> {
    validateNodeId(nodeId);
    const db = await this.dbPromise;
    await db.delete('reservations', reservationId(nodeId, publicationKey));
  }

  async peek(nodeId: string): Promise<number | undefined> {
    validateNodeId(nodeId);
    const db = await this.dbPromise;
    return (await db.get('sequence', nodeId))?.nextSequence;
  }
}
