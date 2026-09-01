const NODE_CREDENTIAL_PREFIX = 'k2n_v1_';
const NODE_ID_PREFIX = 'node_';
const TOKEN_ENTROPY_BYTES = 32;
const NODE_ID_ENTROPY_BYTES = 12;
const MINIMUM_PEPPER_BYTES = 32;

export interface NodeCredentialMaterial {
  /** Returned once to the node. Never persist this raw value server-side. */
  credential: string;
  credentialHmac: string;
  keyVersion: number;
}

export interface NodeCredentialRecordMaterial {
  nodeId: string;
  credentialHmac: string;
  keyVersion: number;
}

export interface NodeEnrollmentMaterial extends NodeCredentialRecordMaterial, NodeCredentialMaterial {}

export type SecureRandomFill = (bytes: Uint8Array<ArrayBuffer>) => void;

function defaultRandomFill(bytes: Uint8Array<ArrayBuffer>): void {
  crypto.getRandomValues(bytes);
}

function base64UrlEncode(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index] ?? 0;
    const b = bytes[index + 1];
    const c = bytes[index + 2];
    const chunk = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    output += alphabet[(chunk >>> 18) & 63] ?? '';
    output += alphabet[(chunk >>> 12) & 63] ?? '';
    output += b === undefined ? '=' : alphabet[(chunk >>> 6) & 63] ?? '';
    output += c === undefined ? '=' : alphabet[chunk & 63] ?? '';
  }
  return output.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(value: string): Uint8Array<ArrayBuffer> | undefined {
  if (!/^[a-f0-9]{64}$/.test(value)) return undefined;
  const bytes = new Uint8Array(new ArrayBuffer(32));
  for (let index = 0; index < bytes.length; index += 1) {
    const octet = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
    if (!Number.isFinite(octet)) return undefined;
    bytes[index] = octet;
  }
  return bytes;
}

function ownArrayBufferView(value: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(new ArrayBuffer(value.byteLength));
  copy.set(value);
  return copy;
}

function pepperBytes(value: string | Uint8Array): Uint8Array<ArrayBuffer> {
  const source = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const bytes = ownArrayBufferView(source);
  if (bytes.byteLength < MINIMUM_PEPPER_BYTES) {
    throw new Error(`Node credential pepper must contain at least ${MINIMUM_PEPPER_BYTES} bytes`);
  }
  return bytes;
}

async function importHmacKey(
  pepper: string | Uint8Array,
  usages: KeyUsage[],
): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    pepperBytes(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    usages,
  );
}

function credentialBytes(credential: string): Uint8Array<ArrayBuffer> {
  return ownArrayBufferView(new TextEncoder().encode(credential));
}

function fillEntropy(length: number, randomFill: SecureRandomFill): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(length));
  randomFill(bytes);
  return bytes;
}

function validatedKeyVersion(value: number | undefined): number {
  const keyVersion = value ?? 1;
  if (!Number.isInteger(keyVersion) || keyVersion < 1 || keyVersion > 32_767) {
    throw new Error('Node credential keyVersion must be an integer within 1..32767');
  }
  return keyVersion;
}

export function isValidNodeId(value: string): boolean {
  return /^node_[A-Za-z0-9_-]{6,80}$/.test(value);
}

export function isValidNodeCredential(value: string): boolean {
  return /^k2n_v1_[A-Za-z0-9_-]{43}$/.test(value);
}

export function generatePseudonymousNodeId(
  randomFill: SecureRandomFill = defaultRandomFill,
): string {
  return `${NODE_ID_PREFIX}${base64UrlEncode(fillEntropy(NODE_ID_ENTROPY_BYTES, randomFill))}`;
}

export function generateNodeCredential(
  randomFill: SecureRandomFill = defaultRandomFill,
): string {
  return `${NODE_CREDENTIAL_PREFIX}${base64UrlEncode(fillEntropy(TOKEN_ENTROPY_BYTES, randomFill))}`;
}

/**
 * Computes the value persisted in private.node_credentials. The raw credential
 * must never be stored server-side. A high-entropy server pepper makes a DB dump
 * insufficient to impersonate a node even though tokens are already 256-bit random.
 */
export async function computeNodeCredentialHmac(
  credential: string,
  pepper: string | Uint8Array,
): Promise<string> {
  if (!isValidNodeCredential(credential)) throw new Error('Invalid Konta2r node credential format');
  const key = await importHmacKey(pepper, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, credentialBytes(credential));
  return bytesToHex(new Uint8Array(signature));
}

/**
 * Verifies a stored HMAC using Web Crypto's MAC verification primitive rather
 * than comparing hexadecimal strings with an application-level early exit.
 */
export async function verifyNodeCredentialHmac(
  credential: string,
  expectedHmac: string,
  pepper: string | Uint8Array,
): Promise<boolean> {
  if (!isValidNodeCredential(credential)) return false;
  const signature = hexToBytes(expectedHmac);
  if (signature === undefined) return false;
  const key = await importHmacKey(pepper, ['verify']);
  return crypto.subtle.verify('HMAC', key, signature, credentialBytes(credential));
}

/**
 * Generates only sensor credential material. This is the primitive used for
 * rotation so an existing node keeps its pseudonymous nodeId unchanged.
 */
export async function createNodeCredentialMaterial(
  pepper: string | Uint8Array,
  options: {
    randomFill?: SecureRandomFill;
    keyVersion?: number;
  } = {},
): Promise<NodeCredentialMaterial> {
  const keyVersion = validatedKeyVersion(options.keyVersion);
  const credential = generateNodeCredential(options.randomFill ?? defaultRandomFill);
  return {
    credential,
    credentialHmac: await computeNodeCredentialHmac(credential, pepper),
    keyVersion,
  };
}

export async function createNodeEnrollmentMaterial(
  pepper: string | Uint8Array,
  options: {
    randomFill?: SecureRandomFill;
    keyVersion?: number;
  } = {},
): Promise<NodeEnrollmentMaterial> {
  const randomFill = options.randomFill ?? defaultRandomFill;
  const nodeId = generatePseudonymousNodeId(randomFill);
  const credentialMaterial = await createNodeCredentialMaterial(pepper, {
    randomFill,
    ...(options.keyVersion === undefined ? {} : { keyVersion: options.keyVersion }),
  });
  return {
    nodeId,
    ...credentialMaterial,
  };
}
