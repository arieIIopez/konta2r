const NODE_CREDENTIAL_PREFIX = 'k2n_v1_';
const NODE_ID_PREFIX = 'node_';
const TOKEN_ENTROPY_BYTES = 32;
const NODE_ID_ENTROPY_BYTES = 12;
const MINIMUM_PEPPER_BYTES = 32;

export interface NodeCredentialRecordMaterial {
  nodeId: string;
  credentialHmac: string;
  keyVersion: number;
}

export interface NodeEnrollmentMaterial extends NodeCredentialRecordMaterial {
  /** Returned once to the enrolling node. Never persist this raw value server-side. */
  credential: string;
}

export type SecureRandomFill = (bytes: Uint8Array) => void;

function defaultRandomFill(bytes: Uint8Array): void {
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

function pepperBytes(value: string | Uint8Array): Uint8Array {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
  if (bytes.byteLength < MINIMUM_PEPPER_BYTES) {
    throw new Error(`Node credential pepper must contain at least ${MINIMUM_PEPPER_BYTES} bytes`);
  }
  return bytes;
}

function fillEntropy(length: number, randomFill: SecureRandomFill): Uint8Array {
  const bytes = new Uint8Array(length);
  randomFill(bytes);
  return bytes;
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
  const key = await crypto.subtle.importKey(
    'raw',
    pepperBytes(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(credential),
  );
  return bytesToHex(new Uint8Array(signature));
}

export async function createNodeEnrollmentMaterial(
  pepper: string | Uint8Array,
  options: {
    randomFill?: SecureRandomFill;
    keyVersion?: number;
  } = {},
): Promise<NodeEnrollmentMaterial> {
  const keyVersion = options.keyVersion ?? 1;
  if (!Number.isInteger(keyVersion) || keyVersion < 1 || keyVersion > 32_767) {
    throw new Error('Node credential keyVersion must be an integer within 1..32767');
  }
  const randomFill = options.randomFill ?? defaultRandomFill;
  const nodeId = generatePseudonymousNodeId(randomFill);
  const credential = generateNodeCredential(randomFill);
  return {
    nodeId,
    credential,
    credentialHmac: await computeNodeCredentialHmac(credential, pepper),
    keyVersion,
  };
}
