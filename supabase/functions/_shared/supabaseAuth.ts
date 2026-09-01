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
      const defaultEnvName = keyMap.default;
      if (typeof defaultEnvName === 'string') {
        const mapped = Deno.env.get(defaultEnvName)?.trim();
        if (mapped) return mapped;
      }
    } catch {
      // Fall through to a clear configuration error.
    }
  }

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
