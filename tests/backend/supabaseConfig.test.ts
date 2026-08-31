import { describe, expect, it } from 'vitest';
import { readSupabaseBrowserConfig } from '../../src/backend/supabaseConfig';

describe('Supabase browser configuration', () => {
  it('accepts HTTPS and a modern publishable key', () => {
    expect(readSupabaseBrowserConfig({
      VITE_SUPABASE_URL: 'https://example.supabase.co/',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abcdefghijklmnopqrstuvwxyz',
    })).toEqual({
      url: 'https://example.supabase.co',
      publishableKey: 'sb_publishable_abcdefghijklmnopqrstuvwxyz',
    });
  });

  it('permits plain HTTP only on localhost development', () => {
    expect(readSupabaseBrowserConfig({
      VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abcdefghijklmnopqrstuvwxyz',
    }).url).toBe('http://127.0.0.1:54321');

    expect(() => readSupabaseBrowserConfig({
      VITE_SUPABASE_URL: 'http://example.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abcdefghijklmnopqrstuvwxyz',
    })).toThrow('HTTPS');
  });

  it('fails closed on secret/service-role keys', () => {
    expect(() => readSupabaseBrowserConfig({
      VITE_SUPABASE_URL: 'https://example.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_do-not-expose-this-key',
    })).toThrow('must never be exposed');

    expect(() => readSupabaseBrowserConfig({
      VITE_SUPABASE_URL: 'https://example.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'service_role_legacy-key-value',
    })).toThrow('must never be exposed');
  });

  it('requires both public environment values explicitly', () => {
    expect(() => readSupabaseBrowserConfig({})).toThrow('VITE_SUPABASE_URL is required');
    expect(() => readSupabaseBrowserConfig({
      VITE_SUPABASE_URL: 'https://example.supabase.co',
    })).toThrow('VITE_SUPABASE_PUBLISHABLE_KEY is required');
  });
});
