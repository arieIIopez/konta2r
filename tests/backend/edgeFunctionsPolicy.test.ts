import { describe, expect, it } from 'vitest';
import configToml from '../../supabase/config.toml?raw';
import enrollFunction from '../../supabase/functions/node-enroll/index.ts?raw';
import ingestFunction from '../../supabase/functions/ingest-community/index.ts?raw';
import postgresShared from '../../supabase/functions/_shared/postgres.ts?raw';
import authShared from '../../supabase/functions/_shared/supabaseAuth.ts?raw';
import storesShared from '../../supabase/functions/_shared/postgresStores.ts?raw';

describe('Supabase Edge Function policy', () => {
  it('keeps human enrollment behind gateway JWT verification and custom sensor ingest outside it', () => {
    expect(configToml).toMatch(/\[functions\.node-enroll\][\s\S]*?verify_jwt\s*=\s*true/);
    expect(configToml).toMatch(/\[functions\.ingest-community\][\s\S]*?verify_jwt\s*=\s*false/);
  });

  it('re-verifies the human through Supabase Auth before privileged enrollment SQL', () => {
    expect(enrollFunction).toContain('verifiedSupabaseUserId(request)');
    expect(authShared).toContain('/auth/v1/user');
    expect(authShared).toContain("authorization?.startsWith('Bearer ')");
    expect(enrollFunction).not.toMatch(/ownerUserId\s*[:=].*body/i);
  });

  it('keeps Community sensor authentication in the domain policy rather than accepting human Bearer auth', () => {
    expect(ingestFunction).toContain('evaluateCommunityIngest');
    expect(ingestFunction).toContain("request.headers.get('authorization')");
    expect(ingestFunction).not.toContain("replace('Bearer '");
  });

  it('pins the direct Postgres dependency and never reaches private tables through a browser/service API key', () => {
    expect(postgresShared).toContain("npm:postgres@3.4.9");
    expect(postgresShared).toContain("requiredEnv('SUPABASE_DB_URL')");
    expect(postgresShared).toContain('prepare: false');
    expect(storesShared).toContain('private.community_batches');
    expect(storesShared).toContain('private.node_credentials');
    expect(storesShared).not.toMatch(/service[_-]?role|sb_secret_/i);
  });

  it('persists node enrollment and Community records inside explicit database transactions', () => {
    expect(storesShared.match(/sql\.begin/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(storesShared).toContain('on conflict (node_id, sequence) do nothing');
    expect(storesShared).toContain('insert into private.flow_aggregates');
    expect(storesShared).toContain('insert into private.spatial_aggregates');
  });

  it('never logs or persists the one-time raw node credential in the Edge Function', () => {
    expect(enrollFunction).toContain('Never log it');
    expect(storesShared).not.toMatch(/credential\s*[:=]/);
    expect(storesShared).toContain('credential_hmac');
  });
});
