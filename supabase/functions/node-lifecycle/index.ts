import {
  applyNodeLifecycleAction,
  type NodeLifecycleAction,
} from '../../../src/backend/nodeLifecycle.ts';
import { activeNodeCredentialKeyVersion, pepperForKeyVersion } from '../_shared/credentialPepper.ts';
import { createPostgresNodeLifecycleStore } from '../_shared/postgresStores.ts';
import { createEdgeSql } from '../_shared/postgres.ts';
import {
  jsonResponse,
  optionsResponse,
  readJsonWithLimit,
} from '../_shared/http.ts';
import { verifiedSupabaseUserId } from '../_shared/supabaseAuth.ts';

const sql = createEdgeSql();
const store = createPostgresNodeLifecycleStore(sql);

function lifecycleBody(value: unknown): { nodeId: string; action: NodeLifecycleAction } | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const body = value as Record<string, unknown>;
  if (typeof body.nodeId !== 'string' || typeof body.action !== 'string') return undefined;
  if (!['activate', 'pause', 'revoke', 'rotate'].includes(body.action)) return undefined;
  return { nodeId: body.nodeId, action: body.action as NodeLifecycleAction };
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return optionsResponse();
  if (request.method !== 'POST') {
    return jsonResponse({ code: 'method_not_allowed' }, 405, { allow: 'POST, OPTIONS' });
  }

  try {
    const ownerUserId = await verifiedSupabaseUserId(request);
    const body = lifecycleBody(await readJsonWithLimit(request, 64 * 1024));
    if (!body) return jsonResponse({ code: 'invalid_lifecycle_payload' }, 422);

    let pepper: string | undefined;
    let keyVersion: number | undefined;
    if (body.action === 'rotate') {
      keyVersion = activeNodeCredentialKeyVersion();
      pepper = await pepperForKeyVersion(sql, keyVersion);
      if (!pepper) return jsonResponse({ code: 'credential_key_unavailable' }, 503);
    }

    const result = await applyNodeLifecycleAction(ownerUserId, body.nodeId, body.action, {
      store,
      ...(pepper === undefined ? {} : { pepper }),
      ...(keyVersion === undefined ? {} : { keyVersion }),
    });

    return jsonResponse({
      code: result.changed ? 'node_lifecycle_applied' : 'node_lifecycle_unchanged',
      action: result.action,
      changed: result.changed,
      node: {
        nodeId: result.nodeId,
        previousStatus: result.previousStatus,
        status: result.status,
      },
      ...(result.credential === undefined ? {} : {
        credential: result.credential,
        credentialVersion: result.credentialVersion,
      }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'missing_human_auth' || message === 'invalid_human_auth') {
      return jsonResponse({ code: 'invalid_human_auth' }, 401);
    }
    if (message === 'request_body_too_large') return jsonResponse({ code: 'request_body_too_large' }, 413);
    if (message === 'invalid_json') return jsonResponse({ code: 'invalid_json' }, 400);
    if (message === 'Node not found for authenticated owner') return jsonResponse({ code: 'node_not_found' }, 404);
    if (
      message.startsWith('Invalid node lifecycle transition')
      || message === 'Revoked nodes cannot rotate credentials'
      || message.includes('state changed during')
    ) return jsonResponse({ code: 'node_lifecycle_conflict' }, 409);
    if (message === 'Invalid KONTA2R_NODE_TOKEN_ACTIVE_KEY_VERSION') {
      return jsonResponse({ code: 'credential_key_unavailable' }, 503);
    }
    if (message === 'Invalid Konta2r node id') return jsonResponse({ code: 'invalid_lifecycle_payload' }, 422);

    console.error('node-lifecycle failed without exposing credential material');
    return jsonResponse({ code: 'node_lifecycle_failed' }, 500);
  }
});
