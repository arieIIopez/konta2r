export interface SupabaseBrowserConfig {
  url: string;
  publishableKey: string;
}

export interface SupabaseBrowserEnvironment {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}

function parseProjectUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('VITE_SUPABASE_URL must be a valid URL');
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error('VITE_SUPABASE_URL must use HTTPS outside local development');
  }
  return url.toString().replace(/\/$/, '');
}

function parsePublishableKey(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('sb_secret_') || /service[_-]?role/i.test(trimmed)) {
    throw new Error('Secret/service-role Supabase keys must never be exposed to the browser');
  }
  if (!trimmed.startsWith('sb_publishable_')) {
    throw new Error('Konta2r browser configuration requires a modern sb_publishable_ Supabase key');
  }
  if (trimmed.length < 24) throw new Error('Supabase publishable key is too short');
  return trimmed;
}

export function readSupabaseBrowserConfig(
  env: SupabaseBrowserEnvironment,
): SupabaseBrowserConfig {
  const url = env.VITE_SUPABASE_URL?.trim();
  const publishableKey = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url) throw new Error('VITE_SUPABASE_URL is required');
  if (!publishableKey) throw new Error('VITE_SUPABASE_PUBLISHABLE_KEY is required');
  return {
    url: parseProjectUrl(url),
    publishableKey: parsePublishableKey(publishableKey),
  };
}
