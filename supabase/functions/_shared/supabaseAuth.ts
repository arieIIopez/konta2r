import { requiredEnv } from './http.ts';

interface SupabaseAuthUser {
  id?: unknown;
}

function publishableKey(): string {
  const direct = Deno.env.get('SUPABASE_PUBLISHABLE_KEY')?.trim();
  if (direct) return direct;

  const keyMapRaw = Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')?.trim();
  if (keyMapRaw) {
    try {
      const keyMap = JSON.parse(keyMapRaw) as Record<string, unknown>;
      const defaultKey = keyMap.default;
      if (typeof defaultKey === 'string' && defaultKey.trim().length > 0) {
        return defaultKey.trim();
      }
    } catch {
      // Fall through to a clear configuration error.
    }
  }

  // Legacy hosted/local projects can still expose the JWT-based anon key.
  // It is acceptable here only as the public API key used to call Auth; the
  // human identity itself is still derived from the Bearer user access token.
  const legacyAnon = Deno.env.get('SUPABASE_ANON_KEY')?.trim();
  if (legacyAnon) return legacyAnon;

  throw new Error('Missing Supabase publishable key for Auth verification');
}

/**
 * Defense in depth for privileged Edge Functions. Even when verify_jwt=true at
 * the gateway, direct database writes must derive owner identity from Supabase
 * Auth rather than trusting request JSON or unverified JWT claims.
 */
export async function verifiedSupabaseUserId(request: Request): Promise<string> {
  const authorization = request.headers.get('authorization')?.trim();
  if (!authorization?.startsWith('Bearer ')) throw new Error('missing_human_auth');

  const response = await fetch(`${requiredEnv('SUPABASE_URL')}/auth/v1/user`, {
    method: 'GET',
    headers: {
      authorization,
      apikey: publishableKey(),
      accept: 'application/json',
    },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('invalid_human_auth');

  const user = await response.json() as SupabaseAuthUser;
  if (typeof user.id !== 'string' || user.id.trim().length === 0) {
    throw new Error('invalid_human_auth');
  }
  return user.id;
}
