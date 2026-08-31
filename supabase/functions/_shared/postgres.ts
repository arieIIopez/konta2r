import postgres from 'npm:postgres@3.4.9';
import { requiredEnv } from './http.ts';

/**
 * Direct Postgres is intentional: private.* stays outside the Supabase Data API.
 * `prepare:false` is compatible with transaction pooler mode.
 */
export function createEdgeSql() {
  return postgres(requiredEnv('SUPABASE_DB_URL'), {
    prepare: false,
    max: 1,
    connect_timeout: 10,
    idle_timeout: 20,
  });
}

export function activeNodeCredentialKeyVersion(): number {
  const raw = Deno.env.get('KONTA2R_NODE_TOKEN_ACTIVE_KEY_VERSION')?.trim() || '1';
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 32_767) {
    throw new Error('Invalid KONTA2R_NODE_TOKEN_ACTIVE_KEY_VERSION');
  }
  return parsed;
}

export function pepperForKeyVersion(keyVersion: number): string | undefined {
  if (!Number.isInteger(keyVersion) || keyVersion < 1 || keyVersion > 32_767) return undefined;
  return Deno.env.get(`KONTA2R_NODE_TOKEN_PEPPER_V${keyVersion}`)?.trim() || undefined;
}
