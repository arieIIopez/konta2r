import { describe, expect, it } from 'vitest';
import configToml from '../../supabase/config.toml?raw';
import enrollFunction from '../../supabase/functions/node-enroll/index.ts?raw';
import lifecycleFunction from '../../supabase/functions/node-lifecycle/index.ts?raw';
import ingestFunction from '../../supabase/functions/ingest-community/index.ts?raw';
import postgresShared from '../../supabase/functions/_shared/postgres.ts?raw';
import authShared from '../../supabase/functions/_shared/supabaseAuth.ts?raw';
import storesShared from '../../supabase/functions/_shared/postgresStores.ts?raw';

describe('Supabase Edge Function policy', () => {
  it('keeps human enrollment/lifecycle behind gateway JWT verification and custom sensor ingest outside it', () => {
    expect(configToml).toMatch(/\[functions\.node-enroll\][\s\S]*?verify_jwt\s*=\s*true/);
    expect(configToml).toMatch(/\[functions\.node-lifecycle\][\s\S]*?verify_jwt\s*=\s*true/);
    expect(configToml).toMatch(/\[functions\.ingest-community\][\s\S]*?verify_jwt\s*=\s*false/);
  });

  it('re-verifies the human through Supabase Auth before privileged enrollment/lifecycle SQL', () => {
    expect(enrollFunction).toContain('verifiedSupabaseUserId(request)');
    expect(lifecycleFunction).toContain('verifiedSupabaseUserId(request)');
    expect(authShared).toContain('/auth/v1/user');
    expect(authShared).toContain("authorization?.startsWith('Bearer ')");
    expect(enrollFunction).not.toMatch(/ownerUserId\s*[:=].*body/i);
    expect(lifecycleFunction).not.toMatch(/ownerUserId\s*[:=].*body/i);
  });

  it('reads modern hosted publishable keys from the JSON dictionary value itself', () => {
    expect(authShared).toContain("Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')");
    expect(authShared).toContain('const defaultKey = keyMap.default');
    expect(authShared).toContain('return defaultKey.trim()');
    expect(authShared).not.toMatch(/Deno\.env\.get\(defaultKey\)/);
    expect(authShared).toContain("Deno.env.get('SUPABASE_ANON_KEY')");
  });

  it('keeps Community sensor authentication in the domain policy rather than accepting human Bearer auth', () => {
    expect(ingestFunction).toContain('evaluateCommunityIngest');
    expect(ingestFunction).toContain("request.headers.get('authorization')");
    expect(ingestFunction).not.toContain("replace('Bearer '");
  });

  it('pins direct Postgres and versions node credentials only through server environment values', () => {
    expect(postgresShared).toContain("npm:postgres@3.4.9");
    expect(postgresShared).toContain("requiredEnv('SUPABASE_DB_URL')");
    expect(postgresShared).toContain('prepare: false');
    expect(postgresShared).toContain('KONTA2R_NODE_TOKEN_ACTIVE_KEY_VERSION');
    expect(postgresShared).toContain('KONTA2R_NODE_TOKEN_PEPPER_V');
    expect(storesShared).toContain('private.community_batches');
    expect(storesShared).toContain('private.node_credentials');
    expect(storesShared).not.toMatch(/service[_-]?role|sb_secret_/i);
  });

  it('serializes lifecycle writes and appends audit evidence inside explicit transactions', () => {
    expect(storesShared.match(/sql\.begin/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(storesShared).toContain('for update');
    expect(storesShared).toContain('insert into private.node_lifecycle_events');
    expect(storesShared).toContain('credential_key_version');
    expect(storesShared).toContain('on conflict (node_id, sequence) do nothing');
    expect(storesShared).toContain('insert into private.flow_aggregates');
    expect(storesShared).toContain('insert into private.spatial_aggregates');
  });

  it('makes rotation return a credential only from the human lifecycle endpoint, never from persistence', () => {
    expect(lifecycleFunction).toContain("body.action === 'rotate'");
    expect(lifecycleFunction).toContain('credential: result.credential');
    expect(storesShared).not.toMatch(/input\.credential(?!Hmac|Version)/);
    expect(storesShared).not.toMatch(/\bcredential\s+(text|varchar|bytea)\b/i);
    expect(storesShared).toContain('credential_hmac');
  });

  it('never logs the one-time raw node credential in enrollment or lifecycle endpoints', () => {
    expect(enrollFunction).toContain('Never log it');
    expect(enrollFunction).not.toMatch(/console\.(log|info|debug).*credential/i);
    expect(lifecycleFunction).not.toMatch(/console\.(log|info|debug).*credential/i);
  });
});
