import {
  isValidNodeCredential,
  isValidNodeId,
  type SecureRandomFill,
} from './nodeCredential.ts';

const VAULT_SCHEMA_VERSION = '1';
const IV_BYTES = 12;

export interface NodeCredentialSecret {
  nodeId: string;
  credential: string;
  keyVersion: number;
}

export interface EncryptedNodeCredentialRecord {
  schemaVersion: '1';
  nodeId: string;
  keyVersion: number;
  iv: Uint8Array<ArrayBuffer>;
  ciphertext: Uint8Array<ArrayBuffer>;
  storedAtMs: number;
}

export interface NodeCredentialVault {
  put(secret: NodeCredentialSecret): Promise<void>;
  get(nodeId: string): Promise<NodeCredentialSecret | undefined>;
  delete(nodeId: string): Promise<void>;
  has(nodeId: string): Promise<boolean>;
}

function ownBytes(value: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(new ArrayBuffer(value.byteLength));
  copy.set(value);
  return copy;
}

function defaultRandomFill(bytes: Uint8Array<ArrayBuffer>): void {
  crypto.getRandomValues(bytes);
}

function validKeyVersion(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 32_767;
}

function validateSecret(secret: NodeCredentialSecret): void {
  if (!isValidNodeId(secret.nodeId)) throw new Error('Invalid Konta2r node id');
  if (!isValidNodeCredential(secret.credential)) throw new Error('Invalid Konta2r node credential');
  if (!validKeyVersion(secret.keyVersion)) throw new Error('Invalid node credential key version');
}

function validateRecord(record: EncryptedNodeCredentialRecord): void {
  if (record.schemaVersion !== VAULT_SCHEMA_VERSION) throw new Error('Unsupported credential vault schema');
  if (!isValidNodeId(record.nodeId)) throw new Error('Invalid encrypted node id');
  if (!validKeyVersion(record.keyVersion)) throw new Error('Invalid encrypted key version');
  if (!(record.iv instanceof Uint8Array) || record.iv.byteLength !== IV_BYTES) {
    throw new Error('Invalid credential vault IV');
  }
  if (!(record.ciphertext instanceof Uint8Array) || record.ciphertext.byteLength < 17) {
    throw new Error('Invalid credential vault ciphertext');
  }
}

function aad(nodeId: string, keyVersion: number): Uint8Array<ArrayBuffer> {
  return ownBytes(new TextEncoder().encode(
    `konta2r-node-credential-v${VAULT_SCHEMA_VERSION}|${nodeId}|${keyVersion}`,
  ));
}

export async function generateNodeCredentialVaultKey(): Promise<CryptoKey> {
  return await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Encrypts the raw sensor credential for local-at-rest persistence. The record
 * intentionally contains no plaintext secret. AES-GCM AAD binds node identity
 * and server-side credential key version so metadata tampering fails decryption.
 */
export async function encryptNodeCredentialSecret(
  secret: NodeCredentialSecret,
  key: CryptoKey,
  options: { randomFill?: SecureRandomFill; nowMs?: number } = {},
): Promise<EncryptedNodeCredentialRecord> {
  validateSecret(secret);
  const randomFill = options.randomFill ?? defaultRandomFill;
  const iv = new Uint8Array(new ArrayBuffer(IV_BYTES));
  randomFill(iv);
  const plaintext = ownBytes(new TextEncoder().encode(secret.credential));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad(secret.nodeId, secret.keyVersion) },
    key,
    plaintext,
  );
  plaintext.fill(0);
  return {
    schemaVersion: VAULT_SCHEMA_VERSION,
    nodeId: secret.nodeId,
    keyVersion: secret.keyVersion,
    iv,
    ciphertext: ownBytes(new Uint8Array(encrypted)),
    storedAtMs: options.nowMs ?? Date.now(),
  };
}

export async function decryptNodeCredentialSecret(
  record: EncryptedNodeCredentialRecord,
  key: CryptoKey,
): Promise<NodeCredentialSecret> {
  validateRecord(record);
  const decrypted = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: ownBytes(record.iv),
      additionalData: aad(record.nodeId, record.keyVersion),
    },
    key,
    ownBytes(record.ciphertext),
  );
  const bytes = new Uint8Array(decrypted);
  const credential = new TextDecoder().decode(bytes);
  bytes.fill(0);
  const secret = {
    nodeId: record.nodeId,
    credential,
    keyVersion: record.keyVersion,
  };
  validateSecret(secret);
  return secret;
}

export function createVaultBackedNodeCredentialProvider(
  vault: NodeCredentialVault,
  nodeId: string,
): () => Promise<string | undefined> {
  if (!isValidNodeId(nodeId)) throw new Error('Invalid Konta2r node id');
  return async () => (await vault.get(nodeId))?.credential;
}
