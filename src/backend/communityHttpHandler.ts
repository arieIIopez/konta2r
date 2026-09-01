import {
  processCommunityIngestion,
  type CommunityIngestionStore,
  type NodeCredentialVerifier,
} from './communityIngestion';

const DEFAULT_MAX_BODY_BYTES = 4 * 1024 * 1024;
const ALLOWED_REQUEST_HEADERS = [
  'authorization',
  'apikey',
  'content-type',
  'idempotency-key',
  'x-konta2r-schema',
  'x-konta2r-methodology',
].join(', ');

export interface CommunityHttpRequestLike {
  method: string;
  headers: Headers;
  text(): Promise<string>;
}

export interface CommunityHttpHandlerLogger {
  error(event: string, error: unknown): void;
}

export interface CommunityHttpHandlerOptions {
  allowedOrigins: readonly string[];
  maxBodyBytes?: number;
  nowMs?: () => number;
  logger?: CommunityHttpHandlerLogger;
}

interface NormalizedCorsConfig {
  allowedOrigins: ReadonlySet<string>;
}

function normalizeOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid CORS origin: ${value}`);
  }
  if (url.origin !== value.replace(/\/$/, '')) {
    throw new Error(`CORS allowlist entries must be origins without paths: ${value}`);
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error(`CORS origin requires HTTPS outside local development: ${value}`);
  }
  return url.origin;
}

function normalizeCors(allowedOrigins: readonly string[]): NormalizedCorsConfig {
  if (allowedOrigins.length === 0) {
    throw new Error('Community HTTP handler requires at least one allowed browser origin');
  }
  return {
    allowedOrigins: new Set(allowedOrigins.map(normalizeOrigin)),
  };
}

function corsHeaders(origin: string | undefined, cors: NormalizedCorsConfig): Headers {
  const headers = new Headers({
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    vary: 'Origin',
  });
  if (origin !== undefined && cors.allowedOrigins.has(origin)) {
    headers.set('access-control-allow-origin', origin);
    headers.set('access-control-allow-methods', 'POST, OPTIONS');
    headers.set('access-control-allow-headers', ALLOWED_REQUEST_HEADERS);
    headers.set('access-control-max-age', '600');
  }
  return headers;
}

function jsonResponse(
  status: number,
  payload: Readonly<Record<string, unknown>>,
  origin: string | undefined,
  cors: NormalizedCorsConfig,
): Response {
  const headers = corsHeaders(origin, cors);
  headers.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(payload), { status, headers });
}

function contentLengthTooLarge(headers: Headers, maxBodyBytes: number): boolean {
  const raw = headers.get('content-length');
  if (raw === null) return false;
  if (!/^\d+$/.test(raw)) return false;
  const value = Number(raw);
  return Number.isFinite(value) && value > maxBodyBytes;
}

/**
 * Deno/Fetch-compatible HTTP boundary for the future Supabase Edge Function.
 *
 * It deliberately does not create a database client or read secrets. Those are
 * composition-root concerns. This handler only manages HTTP/CORS, delegates the
 * security and persistence rules, and sanitizes unexpected infrastructure errors.
 */
export function createCommunityHttpHandler(
  verifier: NodeCredentialVerifier,
  store: CommunityIngestionStore,
  options: CommunityHttpHandlerOptions,
): (request: CommunityHttpRequestLike) => Promise<Response> {
  const cors = normalizeCors(options.allowedOrigins);
  const maxBodyBytes = Math.max(1024, options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES);
  const nowMs = options.nowMs ?? Date.now;

  return async (request) => {
    const origin = request.headers.get('origin') ?? undefined;
    if (origin !== undefined && !cors.allowedOrigins.has(origin)) {
      return jsonResponse(403, { error: 'origin_not_allowed' }, undefined, cors);
    }

    if (request.method.toUpperCase() === 'OPTIONS') {
      const headers = corsHeaders(origin, cors);
      return new Response(null, { status: 204, headers });
    }

    if (contentLengthTooLarge(request.headers, maxBodyBytes)) {
      return jsonResponse(413, { error: 'payload_too_large' }, origin, cors);
    }

    let bodyText: string;
    try {
      bodyText = await request.text();
    } catch (error) {
      options.logger?.error('community_request_body_read_failed', error);
      return jsonResponse(500, { error: 'internal_error' }, origin, cors);
    }

    try {
      const result = await processCommunityIngestion({
        method: request.method,
        headers: request.headers,
        bodyText,
      }, verifier, store, {
        nowMs: nowMs(),
        maxBodyBytes,
      });

      if (!result.ok) {
        return jsonResponse(result.statusCode, { error: result.code }, origin, cors);
      }

      return jsonResponse(result.statusCode, {
        status: result.disposition,
        batchId: result.batchId,
        payloadSha256: result.payloadSha256,
      }, origin, cors);
    } catch (error) {
      options.logger?.error('community_ingestion_internal_failure', error);
      return jsonResponse(500, { error: 'internal_error' }, origin, cors);
    }
  };
}
