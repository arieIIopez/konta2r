export const KONTA2R_GOOGLE_SCOPES = 'openid email profile' as const;

export interface GoogleOAuthRequest {
  provider: 'google';
  options: {
    redirectTo: string;
    scopes: typeof KONTA2R_GOOGLE_SCOPES;
  };
}

export interface SupabaseGoogleAuthClientLike {
  auth: {
    signInWithOAuth(request: GoogleOAuthRequest): Promise<{
      error: { message?: string } | null;
    }>;
    signOut(): Promise<{
      error: { message?: string } | null;
    }>;
  };
}

function normalizedOrigin(value: string): URL {
  let origin: URL;
  try {
    origin = new URL(value);
  } catch {
    throw new Error('Google Auth origin must be a valid URL');
  }
  const local = origin.hostname === 'localhost' || origin.hostname === '127.0.0.1';
  if (origin.protocol !== 'https:' && !(local && origin.protocol === 'http:')) {
    throw new Error('Google Auth requires HTTPS outside local development');
  }
  return origin;
}

/**
 * Human authentication boundary. Google identifies the person; it never
 * authenticates a long-running Konta2r sensor. No Google API/offline scopes are
 * requested, because Konta2r needs identity only.
 */
export function buildGoogleSignInRequest(appOrigin: string): GoogleOAuthRequest {
  const origin = normalizedOrigin(appOrigin);
  const redirect = new URL('/', origin);
  return {
    provider: 'google',
    options: {
      redirectTo: redirect.toString(),
      scopes: KONTA2R_GOOGLE_SCOPES,
    },
  };
}

export async function signInHumanWithGoogle(
  client: SupabaseGoogleAuthClientLike,
  appOrigin: string,
): Promise<void> {
  const { error } = await client.auth.signInWithOAuth(buildGoogleSignInRequest(appOrigin));
  if (error) throw new Error(error.message?.trim() || 'Google sign-in failed');
}

export async function signOutHuman(client: SupabaseGoogleAuthClientLike): Promise<void> {
  const { error } = await client.auth.signOut();
  if (error) throw new Error(error.message?.trim() || 'Sign-out failed');
}
