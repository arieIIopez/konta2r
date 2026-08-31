import type { CommunitySender, DeliveryResult } from './outbox';

export interface CommunityHttpTransportOptions {
  endpoint: string;
  accessToken?: () => Promise<string | undefined> | string | undefined;
  fetchImpl?: typeof fetch;
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

/**
 * Minimal transport for aggregate uploads. Authentication remains pluggable;
 * the payload is already privacy-validated before it reaches the outbox.
 */
export function createCommunityHttpSender(
  options: CommunityHttpTransportOptions,
): CommunitySender {
  const fetchImpl = options.fetchImpl ?? fetch;

  return async (envelope, idempotencyKey): Promise<DeliveryResult> => {
    const token = await options.accessToken?.();
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'idempotency-key': idempotencyKey,
      'x-konta2r-schema': envelope.schemaVersion,
      'x-konta2r-methodology': envelope.methodologyVersion,
    };
    if (token) headers.authorization = `Bearer ${token}`;

    try {
      const response = await fetchImpl(options.endpoint, {
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
