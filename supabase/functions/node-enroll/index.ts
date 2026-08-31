import { enrollNodeForAuthenticatedUser } from '../../../src/backend/nodeEnroll.ts';
import { createPostgresNodeEnrollStore } from '../_shared/postgresStores.ts';
import {
  activeNodeCredentialKeyVersion,
  createEdgeSql,
  pepperForKeyVersion,
} from '../_shared/postgres.ts';
import {
  jsonResponse,
  optionsResponse,
  readJsonWithLimit,
} from '../_shared/http.ts';
import { verifiedSupabaseUserId } from '../_shared/supabaseAuth.ts';

const sql = createEdgeSql();
const store = createPostgresNodeEnrollStore(sql);

function enrollBody(value: unknown): { label: string; segmentId: string } | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const body = value as Record<string, unknown>;
  if (typeof body.label !== 'string' || typeof body.segmentId !== 'string') return undefined;
  return { label: body.label, segmentId: body.segmentId };
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return optionsResponse();
  if (request.method !== 'POST') {
    return jsonResponse({ code: 'method_not_allowed' }, 405, { allow: 'POST, OPTIONS' });
  }

  try {
    // verify_jwt=true blocks unauthenticated traffic at the gateway. This second
    // verification is deliberate because this handler performs privileged SQL.
    const ownerUserId = await verifiedSupabaseUserId(request);
    const body = enrollBody(await readJsonWithLimit(request, 64 * 1024));
    if (!body) return jsonResponse({ code: 'invalid_enrollment_payload' }, 422);

    const keyVersion = activeNodeCredentialKeyVersion();
    const pepper = pepperForKeyVersion(keyVersion);
    if (!pepper) return jsonResponse({ code: 'credential_key_unavailable' }, 503);

    const result = await enrollNodeForAuthenticatedUser(ownerUserId, body, {
      store,
      pepper,
      keyVersion,
    });

    // credential is intentionally returned only in this response. Never log it.
    return jsonResponse({
      code: 'node_enrolled',
      node: {
        nodeId: result.nodeId,
        label: result.label,
        segmentId: result.segmentId,
        status: result.status,
      },
      credential: result.credential,
      credentialVersion: result.keyVersion,
    }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'missing_human_auth' || message === 'invalid_human_auth') {
      return jsonResponse({ code: 'invalid_human_auth' }, 401);
    }
    if (message === 'request_body_too_large') {
      return jsonResponse({ code: 'request_body_too_large' }, 413);
    }
    if (message === 'invalid_json') {
      return jsonResponse({ code: 'invalid_json' }, 400);
    }
    if (
      message.includes('1..120')
      || message.includes('1..160')
      || message === 'Observed segment does not exist'
    ) {
      return jsonResponse({ code: 'invalid_enrollment_payload' }, 422);
    }
    if (message === 'Invalid KONTA2R_NODE_TOKEN_ACTIVE_KEY_VERSION') {
      return jsonResponse({ code: 'credential_key_unavailable' }, 503);
    }

    console.error('node-enroll failed without exposing credential material');
    return jsonResponse({ code: 'node_enroll_failed' }, 500);
  }
});
