import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { signInHumanWithGoogle, signOutHuman } from './googleAuth';

export interface HumanAuthSnapshot {
  authenticated: boolean;
  email?: string;
}

export interface HumanAuthClient {
  snapshot(): Promise<HumanAuthSnapshot>;
  accessToken(): Promise<string | undefined>;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  subscribe(listener: () => void): () => void;
}

export interface SupabaseBrowserAuthOptions {
  projectUrl: string;
  publishableKey: string;
  appOrigin: string;
}

function safeProjectUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('Supabase project URL must be a valid URL');
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error('Supabase browser auth requires HTTPS outside local development');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('Supabase project URL must not contain credentials, query, or fragment');
  }
  url.pathname = url.pathname.replace(/\/+$/g, '');
  return url.toString().replace(/\/$/, '');
}

function safePublishableKey(value: string): string {
  const key = value.trim();
  if (!key) throw new Error('Supabase publishable key is required');
  if (/^sb_secret_/i.test(key)) {
    throw new Error('Supabase secret keys must never be used in the Konta2r browser client');
  }
  return key;
}

function toSnapshot(session: Session | null): HumanAuthSnapshot {
  const email = session?.user.email?.trim();
  return {
    authenticated: session !== null,
    ...(email ? { email } : {}),
  };
}

export function createSupabaseHumanAuth(options: SupabaseBrowserAuthOptions): HumanAuthClient {
  const projectUrl = safeProjectUrl(options.projectUrl);
  const publishableKey = safePublishableKey(options.publishableKey);
  const client: SupabaseClient = createClient(projectUrl, publishableKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
    },
  });

  async function session(): Promise<Session | null> {
    const { data, error } = await client.auth.getSession();
    if (error) throw new Error(error.message || 'Unable to read Supabase Auth session');
    return data.session;
  }

  return {
    async snapshot(): Promise<HumanAuthSnapshot> {
      return toSnapshot(await session());
    },

    async accessToken(): Promise<string | undefined> {
      return (await session())?.access_token;
    },

    async signIn(): Promise<void> {
      await signInHumanWithGoogle(client, options.appOrigin);
    },

    async signOut(): Promise<void> {
      await signOutHuman(client);
    },

    subscribe(listener): () => void {
      const { data } = client.auth.onAuthStateChange(() => listener());
      return () => data.subscription.unsubscribe();
    },
  };
}
