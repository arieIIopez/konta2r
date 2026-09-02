import { describe, expect, it } from 'vitest';
import gitignore from '../../.gitignore?raw';
import browserEnv from '../../.env.example?raw';
import functionEnv from '../../supabase/functions/.env.example?raw';
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

  it('documents a versioned server-only credential pepper without committing one', () => {
    expect(functionEnv).toContain('KONTA2R_NODE_TOKEN_ACTIVE_KEY_VERSION=1');
    expect(functionEnv).toContain('KONTA2R_NODE_TOKEN_PEPPER_V1=REPLACE_WITH_RANDOM_SECRET');
    expect(functionEnv).not.toMatch(/KONTA2R_NODE_TOKEN_PEPPER_V1=[a-f0-9]{32,}/i);
    expect(functionEnv).toContain('Supabase automatically provides');
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

  it('keeps live deployment gated on a dedicated project and advisors', () => {
    expect(deploymentRunbook).toContain('dedicated Konta2r Supabase project');
    expect(deploymentRunbook).toContain('Security Advisor');
    expect(deploymentRunbook).toContain('Performance Advisor');
    expect(deploymentRunbook).toContain('no unrelated Supabase project was modified');
  });
});
