import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import {
  decryptNodeCredentialSecret,
  encryptNodeCredentialSecret,
  generateNodeCredentialVaultKey,
  type EncryptedNodeCredentialRecord,
  type NodeCredentialSecret,
  type NodeCredentialVault,
} from './nodeCredentialVault.ts';

interface Konta2rNodeSecretsSchema extends DBSchema {
  keys: {
    key: string;
    value: CryptoKey;
  };
  credentials: {
    key: string;
    value: EncryptedNodeCredentialRecord;
  };
}

const DB_NAME = 'Konta2rNodeSecretsDB';
const DB_VERSION = 1;
const VAULT_KEY_ID = 'node-credential-aes-gcm-v1';

/**
 * Browser persistence for unattended nodes. The AES key is non-extractable and
 * stored via IndexedDB structured clone. This protects against accidental
 * plaintext-at-rest exposure, not against arbitrary JavaScript executing with
 * control of the same origin.
 */
export class IndexedDbNodeCredentialVault implements NodeCredentialVault {
  private readonly dbPromise: Promise<IDBPDatabase<Konta2rNodeSecretsSchema>>;

  constructor(name = DB_NAME) {
    this.dbPromise = openDB<Konta2rNodeSecretsSchema>(name, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('keys')) {
          db.createObjectStore('keys');
        }
        if (!db.objectStoreNames.contains('credentials')) {
          db.createObjectStore('credentials', { keyPath: 'nodeId' });
        }
      },
    });
  }

  private async existingKey(): Promise<CryptoKey | undefined> {
    const db = await this.dbPromise;
    return await db.get('keys', VAULT_KEY_ID);
  }

  private async getOrCreateKey(): Promise<CryptoKey> {
    const db = await this.dbPromise;
    const existing = await db.get('keys', VAULT_KEY_ID);
    if (existing) return existing;

    // Generate before opening the write transaction so WebCrypto cannot cause an
    // IndexedDB transaction to auto-close while awaiting entropy/key generation.
    const generated = await generateNodeCredentialVaultKey();
    const tx = db.transaction('keys', 'readwrite');
    const raced = await tx.store.get(VAULT_KEY_ID);
    if (raced) {
      await tx.done;
      return raced;
    }
    await tx.store.put(generated, VAULT_KEY_ID);
    await tx.done;
    return generated;
  }

  async put(secret: NodeCredentialSecret): Promise<void> {
    const key = await this.getOrCreateKey();
    const record = await encryptNodeCredentialSecret(secret, key);
    const db = await this.dbPromise;
    await db.put('credentials', record);
  }

  async get(nodeId: string): Promise<NodeCredentialSecret | undefined> {
    const db = await this.dbPromise;
    const record = await db.get('credentials', nodeId);
    if (!record) return undefined;

    // Never manufacture a replacement key while reading an existing ciphertext:
    // losing the original key must fail closed instead of silently creating a key
    // that can never decrypt the record.
    const key = await this.existingKey();
    if (!key) return undefined;
    try {
      return await decryptNodeCredentialSecret(record, key);
    } catch {
      return undefined;
    }
  }

  async delete(nodeId: string): Promise<void> {
    const db = await this.dbPromise;
    await db.delete('credentials', nodeId);
  }

  async has(nodeId: string): Promise<boolean> {
    return (await this.get(nodeId)) !== undefined;
  }
}
