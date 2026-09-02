import { describe, expect, it } from 'vitest';
import gitignore from '../../.gitignore?raw';
import browserEnv from '../../.env.example?raw';
import functionEnv from '../../supabase/functions/.env.example?raw';
import vaultSql from '../../supabase/vault.sql?raw';
import smokeScript from '../../tools/supabase-http-smoke.mjs?raw';
import lifecycleScript from '../../tools/supabase-e2e-lifecycle.mjs?raw';
import deploymentRunbook from '../../docs/supabase-deployment.md?raw';

describe('Supabase deployment readiness', () => {
  it('ignores populated environment files while retaining reviewed examples', () => {
    expect(gitignore).toMatch(/^\.env$/m);
    expect(gitignore).toMatch(/^\.env\.\*$/m);
    expect(gitignore).toContain('!.env.example');
    expect(gitignore).toContain('!supabase/functions/.env.example');
    expect(gitignore).toContain('supabase/.temp/');
  });

  it('keeps browser configuration publishable-only', () => {
    expect(browserEnv).toContain('VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_REPLACE_ME');
    expect(browserEnv).not.toMatch(/^\s*VITE_.*(sb_secret_|service_role|DB_URL|PASSWORD)/mi);
    expect(browserEnv).not.toContain('KONTA2R_NODE_TOKEN_PEPPER');
  });

  it('keeps node credential peppers out of env files and generates them inside Vault', () => {
    expect(functionEnv).not.toContain('KONTA2R_NODE_TOKEN_PEPPER_V1=');
    expect(functionEnv).toContain('Supabase Vault');
    expect(vaultSql).toContain("'konta2r_node_token_pepper_v1'");
    expect(vaultSql).toContain('extensions.gen_random_bytes(48)');
    expect(vaultSql).toContain('vault.create_secret');
    expect(vaultSql).not.toMatch(/[A-Fa-f0-9]{64,}/);
  });

  it('refuses secret API keys in client-style deployed probes', () => {
    expect(smokeScript).toContain("publishableKey.startsWith('sb_secret_')");
    expect(lifecycleScript).toContain("publishableKey.startsWith('sb_secret_')");
  });

  it('does not print raw human or sensor credential variables', () => {
    expect(lifecycleScript).not.toMatch(/console\.(log|info|debug)\([^\n]*(userJwt|credential|rotatedCredential)/);
    expect(lifecycleScript).toContain("credential = '<redacted>'");
    expect(deploymentRunbook).toContain('Do not paste that token into chat or commit it.');
  });

  it('keeps live deployment gated on the dedicated Free project and advisors', () => {
    expect(deploymentRunbook).toContain('dedicated Supabase project');
    expect(deploymentRunbook).toContain('project: `konta2r`');
    expect(deploymentRunbook).toContain('organization plan: `free`');
    expect(deploymentRunbook).toContain('Security Advisor');
    expect(deploymentRunbook).toContain('Performance Advisor');
    expect(deploymentRunbook).toContain('no unrelated Supabase project was modified');
  });
});
