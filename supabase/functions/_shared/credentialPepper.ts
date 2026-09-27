import type { EdgeSql } from './postgresStores.ts';

const SECRET_PREFIX = 'konta2r_node_token_pepper_v';

export function activeNodeCredentialKeyVersion(): number {
  const raw = Deno.env.get('KONTA2R_NODE_TOKEN_ACTIVE_KEY_VERSION')?.trim() || '1';
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 32_767) {
    throw new Error('Invalid KONTA2R_NODE_TOKEN_ACTIVE_KEY_VERSION');
  }
  return parsed;
}

export async function pepperForKeyVersion(
  sql: EdgeSql,
  keyVersion: number,
): Promise<string | undefined> {
  if (!Number.isInteger(keyVersion) || keyVersion < 1 || keyVersion > 32_767) return undefined;
  const name = `${SECRET_PREFIX}${keyVersion}`;
  const rows = await sql`
    select decrypted_secret
    from vault.decrypted_secrets
    where name = ${name}
    limit 1
  `;
  const row = rows[0] as Record<string, unknown> | undefined;
  return typeof row?.decrypted_secret === 'string' && row.decrypted_secret.length >= 32
    ? row.decrypted_secret
    : undefined;
}
