import { describe, expect, it } from 'vitest';
import {
  buildGoogleSignInRequest,
  KONTA2R_GOOGLE_SCOPES,
  signInHumanWithGoogle,
  signOutHuman,
  type GoogleOAuthRequest,
} from '../../src/auth/googleAuth';

class FakeGoogleClient {
  requests: GoogleOAuthRequest[] = [];
  signOutCount = 0;
  signInError: { message?: string } | null = null;
  signOutError: { message?: string } | null = null;

  readonly auth = {
    signInWithOAuth: async (request: GoogleOAuthRequest) => {
      this.requests.push(request);
      return { error: this.signInError };
    },
    signOut: async () => {
      this.signOutCount += 1;
      return { error: this.signOutError };
    },
  };
}

describe('Google Auth boundary', () => {
  it('requests identity-only scopes and no Google offline/API permissions', () => {
    const request = buildGoogleSignInRequest('https://konta2r.example');
    expect(request).toEqual({
      provider: 'google',
      options: {
        redirectTo: 'https://konta2r.example/',
        scopes: 'openid email profile',
      },
    });
    expect(request.options.scopes).toBe(KONTA2R_GOOGLE_SCOPES);
    expect('queryParams' in request.options).toBe(false);
  });

  it('permits localhost but refuses insecure remote origins', () => {
    expect(buildGoogleSignInRequest('http://localhost:5173').options.redirectTo)
      .toBe('http://localhost:5173/');
    expect(() => buildGoogleSignInRequest('http://konta2r.example')).toThrow('HTTPS');
  });

  it('delegates human sign-in and sign-out to the injected Supabase Auth client', async () => {
    const client = new FakeGoogleClient();
    await signInHumanWithGoogle(client, 'https://konta2r.example');
    expect(client.requests).toHaveLength(1);
    expect(client.requests[0]?.provider).toBe('google');
    await signOutHuman(client);
    expect(client.signOutCount).toBe(1);
  });

  it('surfaces provider errors without creating an alternate auth path', async () => {
    const client = new FakeGoogleClient();
    client.signInError = { message: 'provider unavailable' };
    await expect(signInHumanWithGoogle(client, 'https://konta2r.example'))
      .rejects.toThrow('provider unavailable');
    client.signOutError = { message: 'session failure' };
    await expect(signOutHuman(client)).rejects.toThrow('session failure');
  });
});
