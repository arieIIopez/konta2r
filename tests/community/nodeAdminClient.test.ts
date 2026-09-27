import { describe, expect, it } from 'vitest';
import { createNodeAdminClient } from '../../src/community/nodeAdminClient';

const PROJECT_URL = 'https://example-project.supabase.co';
const PUBLISHABLE_KEY = 'sb_publishable_browser-safe';
const ACCESS_TOKEN = 'header.payload.signature';
const NODE_ID = 'node_client01';
const CREDENTIAL = `k2n_v1_${'A'.repeat(43)}`;

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('node administration HTTP client', () => {
  it('sends publishable API key separately from the authenticated human JWT', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const client = createNodeAdminClient({
      projectUrl: PROJECT_URL,
      publishableKey: PUBLISHABLE_KEY,
      accessToken: () => ACCESS_TOKEN,
      fetchImpl: (async (input, init) => {
        requests.push({ url: String(input), ...(init === undefined ? {} : { init }) });
        return response({
          code: 'node_enrolled',
          node: {
            nodeId: NODE_ID,
            label: 'Ventana norte',
            segmentId: 'osm:way:123',
            status: 'provisioning',
          },
          credential: CREDENTIAL,
          credentialVersion: 2,
        }, 201);
      }) as typeof fetch,
    });

    const enrolled = await client.enroll({ label: 'Ventana norte', segmentId: 'osm:way:123' });
    expect(enrolled.credential).toBe(CREDENTIAL);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(`${PROJECT_URL}/functions/v1/node-enroll`);
    expect(new Headers(requests[0]?.init?.headers).get('apikey')).toBe(PUBLISHABLE_KEY);
    expect(new Headers(requests[0]?.init?.headers).get('authorization')).toBe(`Bearer ${ACCESS_TOKEN}`);
    expect(requests[0]?.init?.body).toBe(JSON.stringify({ label: 'Ventana norte', segmentId: 'osm:way:123' }));
  });

  it('parses lifecycle credential rotation without exposing it in the request', async () => {
    let requestBody = '';
    const client = createNodeAdminClient({
      projectUrl: PROJECT_URL,
      publishableKey: PUBLISHABLE_KEY,
      accessToken: () => ACCESS_TOKEN,
      fetchImpl: (async (_input, init) => {
        requestBody = String(init?.body ?? '');
        return response({
          code: 'node_lifecycle_applied',
          action: 'rotate',
          changed: true,
          node: {
            nodeId: NODE_ID,
            previousStatus: 'active',
            status: 'active',
          },
          credential: CREDENTIAL,
          credentialVersion: 3,
        });
      }) as typeof fetch,
    });

    const rotated = await client.lifecycle(NODE_ID, 'rotate');
    expect(rotated.credential).toBe(CREDENTIAL);
    expect(rotated.credentialVersion).toBe(3);
    expect(requestBody).toBe(JSON.stringify({ nodeId: NODE_ID, action: 'rotate' }));
    expect(requestBody).not.toContain(CREDENTIAL);
  });

  it('preserves backend error codes for UI decisions', async () => {
    const client = createNodeAdminClient({
      projectUrl: PROJECT_URL,
      publishableKey: PUBLISHABLE_KEY,
      accessToken: () => ACCESS_TOKEN,
      fetchImpl: (async () => response({ code: 'node_lifecycle_conflict' }, 409)) as typeof fetch,
    });

    await expect(client.lifecycle(NODE_ID, 'pause')).rejects.toMatchObject({
      status: 409,
      code: 'node_lifecycle_conflict',
    });
  });

  it('rejects browser use of secret API keys and API keys masquerading as human auth', async () => {
    expect(() => createNodeAdminClient({
      projectUrl: PROJECT_URL,
      publishableKey: 'sb_secret_never-in-browser',
      accessToken: () => ACCESS_TOKEN,
    })).toThrow('secret keys');

    const client = createNodeAdminClient({
      projectUrl: PROJECT_URL,
      publishableKey: PUBLISHABLE_KEY,
      accessToken: () => PUBLISHABLE_KEY,
      fetchImpl: (async () => response({})) as typeof fetch,
    });
    await expect(client.enroll({ label: 'Nodo', segmentId: 'segment' }))
      .rejects.toThrow('access token');
  });

  it('rejects malformed successful responses rather than persisting ambiguous identity data', async () => {
    const client = createNodeAdminClient({
      projectUrl: PROJECT_URL,
      publishableKey: PUBLISHABLE_KEY,
      accessToken: () => ACCESS_TOKEN,
      fetchImpl: (async () => response({ code: 'node_enrolled', credential: CREDENTIAL }, 201)) as typeof fetch,
    });
    await expect(client.enroll({ label: 'Nodo', segmentId: 'segment' }))
      .rejects.toThrow('invalid success response');
  });
});
