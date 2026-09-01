import type { NodeLifecycleAction } from '../backend/nodeLifecycle';
import type { NodeOperationalStatus } from '../backend/communityIngest';

export interface HumanNodeIdentity {
  nodeId: string;
  label: string;
  segmentId: string;
  status: NodeOperationalStatus;
}

export interface NodeEnrollmentResponse {
  node: HumanNodeIdentity;
  credential: string;
  credentialVersion: number;
}

export interface NodeLifecycleResponse {
  action: NodeLifecycleAction;
  changed: boolean;
  node: {
    nodeId: string;
    previousStatus: NodeOperationalStatus;
    status: NodeOperationalStatus;
  };
  credential?: string;
  credentialVersion?: number;
}

export interface NodeAdminClient {
  enroll(input: { label: string; segmentId: string }): Promise<NodeEnrollmentResponse>;
  lifecycle(nodeId: string, action: NodeLifecycleAction): Promise<NodeLifecycleResponse>;
}

export interface NodeAdminClientOptions {
  projectUrl: string;
  publishableKey: string;
  accessToken: () => Promise<string | undefined> | string | undefined;
  fetchImpl?: typeof fetch;
}

export class NodeAdminHttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(`Konta2r node administration failed (${status} ${code})`);
    this.name = 'NodeAdminHttpError';
    this.status = status;
    this.code = code;
  }
}

function normalizedProjectUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Supabase project URL must be a valid URL');
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error('Supabase project URL requires HTTPS outside local development');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('Supabase project URL must not contain credentials, query, or fragment');
  }
  url.pathname = url.pathname.replace(/\/+$/g, '');
  return url;
}

function safePublishableKey(value: string): string {
  const key = value.trim();
  if (!key) throw new Error('Supabase publishable key is required');
  if (/^sb_secret_/i.test(key)) throw new Error('Supabase secret keys must never be used by the browser');
  return key;
}

function validHumanAccessToken(value: string | undefined): string {
  const token = value?.trim();
  if (!token) throw new Error('Authenticated human session is required');
  if (/^sb_(publishable|secret)_/i.test(token)) {
    throw new Error('Human Authorization must use a Supabase Auth access token, not an API key');
  }
  return token;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function status(value: unknown): NodeOperationalStatus | undefined {
  return typeof value === 'string' && ['provisioning', 'active', 'paused', 'revoked'].includes(value)
    ? value as NodeOperationalStatus
    : undefined;
}

async function jsonRecord(response: Response): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new Error('Konta2r node administration returned invalid JSON');
  }
  const parsed = record(value);
  if (!parsed) throw new Error('Konta2r node administration returned an invalid response');
  return parsed;
}

function apiError(response: Response, body: Record<string, unknown>): NodeAdminHttpError {
  const code = typeof body.code === 'string' && body.code.trim() ? body.code : 'unknown_error';
  return new NodeAdminHttpError(response.status, code);
}

function enrollment(body: Record<string, unknown>): NodeEnrollmentResponse | undefined {
  const node = record(body.node);
  const nodeStatus = status(node?.status);
  if (
    body.code !== 'node_enrolled'
    || !node
    || typeof node.nodeId !== 'string'
    || typeof node.label !== 'string'
    || typeof node.segmentId !== 'string'
    || nodeStatus === undefined
    || typeof body.credential !== 'string'
    || typeof body.credentialVersion !== 'number'
  ) return undefined;
  return {
    node: {
      nodeId: node.nodeId,
      label: node.label,
      segmentId: node.segmentId,
      status: nodeStatus,
    },
    credential: body.credential,
    credentialVersion: body.credentialVersion,
  };
}

function lifecycle(body: Record<string, unknown>): NodeLifecycleResponse | undefined {
  const node = record(body.node);
  const previousStatus = status(node?.previousStatus);
  const nextStatus = status(node?.status);
  const action = typeof body.action === 'string' && ['activate', 'pause', 'revoke', 'rotate'].includes(body.action)
    ? body.action as NodeLifecycleAction
    : undefined;
  if (
    !['node_lifecycle_applied', 'node_lifecycle_unchanged'].includes(String(body.code))
    || action === undefined
    || typeof body.changed !== 'boolean'
    || !node
    || typeof node.nodeId !== 'string'
    || previousStatus === undefined
    || nextStatus === undefined
  ) return undefined;
  if (body.credential !== undefined && typeof body.credential !== 'string') return undefined;
  if (body.credentialVersion !== undefined && typeof body.credentialVersion !== 'number') return undefined;
  return {
    action,
    changed: body.changed,
    node: {
      nodeId: node.nodeId,
      previousStatus,
      status: nextStatus,
    },
    ...(typeof body.credential === 'string' ? { credential: body.credential } : {}),
    ...(typeof body.credentialVersion === 'number' ? { credentialVersion: body.credentialVersion } : {}),
  };
}

export function createNodeAdminClient(options: NodeAdminClientOptions): NodeAdminClient {
  const projectUrl = normalizedProjectUrl(options.projectUrl);
  const publishableKey = safePublishableKey(options.publishableKey);
  const fetchImpl = options.fetchImpl ?? fetch;

  async function invoke(path: string, payload: unknown): Promise<{ response: Response; body: Record<string, unknown> }> {
    const accessToken = validHumanAccessToken(await options.accessToken());
    const endpoint = new URL(`/functions/v1/${path}`, projectUrl);
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        apikey: publishableKey,
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const body = await jsonRecord(response);
    if (!response.ok) throw apiError(response, body);
    return { response, body };
  }

  return {
    async enroll(input): Promise<NodeEnrollmentResponse> {
      const { body } = await invoke('node-enroll', input);
      const result = enrollment(body);
      if (!result) throw new Error('Konta2r node enrollment returned an invalid success response');
      return result;
    },

    async lifecycle(nodeId, action): Promise<NodeLifecycleResponse> {
      const { body } = await invoke('node-lifecycle', { nodeId, action });
      const result = lifecycle(body);
      if (!result) throw new Error('Konta2r node lifecycle returned an invalid success response');
      return result;
    },
  };
}
