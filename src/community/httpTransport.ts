import { isValidNodeCredential } from '../backend/nodeCredential';
import type { CommunitySender, DeliveryResult } from './outbox';

export interface CommunityHttpTransportOptions {
  endpoint: string;
  /** Dedicated sensor credential. Never pass a Supabase/Google human session token here. */
  nodeCredential: () => Promise<string | undefined> | string | undefined;
  fetchImpl?: typeof fetch;
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function normalizeEndpoint(value: string): string {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new Error('Community endpoint must be a valid URL');
  }
  const local = endpoint.hostname === 'localhost' || endpoint.hostname === '127.0.0.1';
  if (endpoint.protocol !== 'https:' && !(local && endpoint.protocol === 'http:')) {
    throw new Error('Community endpoint requires HTTPS outside local development');
  }
  return endpoint.toString();
}

/**
 * Aggregate-only transport authenticated as a Konta2r sensor. Authorization uses
 * a dedicated scheme so a human Supabase/Google Bearer token cannot be silently
 * substituted for the long-running node identity.
 */
export function createCommunityHttpSender(
  options: CommunityHttpTransportOptions,
): CommunitySender {
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = normalizeEndpoint(options.endpoint);

  return async (envelope, idempotencyKey): Promise<DeliveryResult> => {
    const credential = await options.nodeCredential();
    if (!credential || !isValidNodeCredential(credential)) {
      return {
        ok: false,
        retryable: false,
        statusCode: 401,
        error: 'Konta2r node credential unavailable or invalid',
      };
    }

    const headers: Record<string, string> = {
      authorization: `Konta2rNode ${credential}`,
      'content-type': 'application/json',
      'idempotency-key': idempotencyKey,
      'x-konta2r-schema': envelope.schemaVersion,
      'x-konta2r-methodology': envelope.methodologyVersion,
    };

    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(envelope),
        cache: 'no-store',
      });

      if (response.ok) {
        return { ok: true, retryable: false, statusCode: response.status };
      }

      return {
        ok: false,
        retryable: retryableStatus(response.status),
        statusCode: response.status,
        error: `HTTP ${response.status}`,
      };
    } catch (error) {
      return {
        ok: false,
        retryable: true,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };
}
