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
