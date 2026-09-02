import { evaluateCommunityIngest } from '../../../src/backend/communityIngest.ts';
import { pepperForKeyVersion } from '../_shared/credentialPepper.ts';
import { createPostgresCommunityIngestStore } from '../_shared/postgresStores.ts';
import { createEdgeSql } from '../_shared/postgres.ts';
import {
  jsonResponse,
  optionsResponse,
  readJsonWithLimit,
} from '../_shared/http.ts';

const sql = createEdgeSql();
const store = createPostgresCommunityIngestStore(sql);

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return optionsResponse();
  if (request.method !== 'POST') {
    return jsonResponse({ code: 'method_not_allowed' }, 405, { allow: 'POST, OPTIONS' });
  }

  let body: unknown;
  try {
    body = await readJsonWithLimit(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'request_body_too_large') {
      return jsonResponse({ code: 'request_body_too_large' }, 413);
    }
    return jsonResponse({ code: 'invalid_json' }, 400);
  }

  try {
    const decision = await evaluateCommunityIngest({
      authorization: request.headers.get('authorization') ?? undefined,
      idempotencyKey: request.headers.get('idempotency-key') ?? undefined,
      body,
    }, {
      store,
      pepperForKeyVersion: (keyVersion) => pepperForKeyVersion(sql, keyVersion),
    });

    return jsonResponse({
      code: decision.code,
      outcome: decision.outcome,
      ...(decision.batchId === undefined ? {} : { batchId: decision.batchId }),
    }, decision.statusCode);
  } catch {
    console.error('ingest-community failed after request authentication/validation');
    return jsonResponse({ code: 'community_ingest_unavailable' }, 503);
  }
});
