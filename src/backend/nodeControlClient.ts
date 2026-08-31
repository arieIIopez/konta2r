import {
  isValidNodeCredential,
  isValidNodeId,
} from './nodeCredential.ts';
import type { NodeCredentialVault } from './nodeCredentialVault.ts';
import type { SupabaseBrowserConfig } from './supabaseConfig.ts';
import type { NodeLifecycleAction } from './nodeLifecycle.ts';

export interface NodeControlClientOptions {
  config: SupabaseBrowserConfig;
  accessToken: () => Promise<string | undefined> | string | undefined;
  vault: NodeCredentialVault;
  fetchImpl?: typeof fetch;
}

export interface NodeControlNodeResult {
  nodeId: string;
  status: 'provisioning' | 'active' | 'paused' | 'revoked';
  previousStatus?: 'provisioning' | 'active' | 'paused' | 'revoked';
  label?: string;
  segmentId?: string;
  credentialVersion?: number;
  credentialStored: boolean;
}

export interface NodeControlClient {
  enroll(label: string, segmentId: string): Promise<NodeControlNodeResult>;
  lifecycle(nodeId: string, action: NodeLifecycleAction): Promise<NodeControlNodeResult>;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function validStatus(value: unknown): value is NodeControlNodeResult['status'] {
  return typeof value === 'string' && ['provisioning', 'active', 'paused', 'revoked'].includes(value);
}

function validCredentialVersion(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 32_767;
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = await response.json() as unknown;
  } catch {
    throw new Error(`Node control returned invalid JSON (HTTP ${response.status})`);
  }
  const body = record(value);
  if (!body) throw new Error(`Node control returned invalid JSON (HTTP ${response.status})`);
  if (!response.ok) {
    const code = typeof body.code === 'string' ? body.code : 'node_control_failed';
    throw new Error(`Node control request failed: ${code} (HTTP ${response.status})`);
  }
  return body;
}

function parseNode(body: Record<string, unknown>): NodeControlNodeResult {
  const node = record(body.node);
  if (!node || typeof node.nodeId !== 'string' || !isValidNodeId(node.nodeId) || !validStatus(node.status)) {
    throw new Error('Node control response has invalid node metadata');
  }
  const previousStatus = node.previousStatus;
  if (previousStatus !== undefined && !validStatus(previousStatus)) {
    throw new Error('Node control response has invalid previous status');
  }
  const label = node.label;
  const segmentId = node.segmentId;
  if (label !== undefined && typeof label !== 'string') throw new Error('Node control response has invalid label');
  if (segmentId !== undefined && typeof segmentId !== 'string') {
    throw new Error('Node control response has invalid segment');
  }
  return {
    nodeId: node.nodeId,
    status: node.status,
    ...(previousStatus === undefined ? {} : { previousStatus }),
    ...(label === undefined ? {} : { label }),
    ...(segmentId === undefined ? {} : { segmentId }),
    credentialStored: false,
  };
}

function endpoint(config: SupabaseBrowserConfig, functionName: string): string {
  return `${config.url}/functions/v1/${functionName}`;
}

export function createNodeControlClient(options: NodeControlClientOptions): NodeControlClient {
  const fetchImpl = options.fetchImpl ?? fetch;

  async function post(functionName: string, payload: unknown): Promise<Record<string, unknown>> {
    const accessToken = await options.accessToken();
    if (!accessToken) throw new Error('Human Supabase session unavailable');
    const response = await fetchImpl(endpoint(options.config, functionName), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        apikey: options.config.publishableKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });
    return await responseJson(response);
  }

  async function persistReturnedCredential(
    body: Record<string, unknown>,
    node: NodeControlNodeResult,
  ): Promise<NodeControlNodeResult> {
    const credential = body.credential;
    const credentialVersion = body.credentialVersion;
    if (
      typeof credential !== 'string'
      || !isValidNodeCredential(credential)
      || !validCredentialVersion(credentialVersion)
    ) {
      throw new Error('Node control response omitted valid credential material');
    }
    try {
      await options.vault.put({
        nodeId: node.nodeId,
        credential,
        keyVersion: credentialVersion,
      });
    } catch {
      // Do not put the raw credential into the error. Human auth can recover by
      // rotating again (or re-enrolling if initial provisioning is abandoned).
      throw new Error('Node credential could not be persisted locally');
    }
    return {
      ...node,
      credentialVersion,
      credentialStored: true,
    };
  }

  return {
    async enroll(label: string, segmentId: string): Promise<NodeControlNodeResult> {
      const body = await post('node-enroll', { label, segmentId });
      const node = parseNode(body);
      if (node.status !== 'provisioning') {
        throw new Error('New node did not return provisioning state');
      }
      return await persistReturnedCredential(body, node);
    },

    async lifecycle(nodeId: string, action: NodeLifecycleAction): Promise<NodeControlNodeResult> {
      if (!isValidNodeId(nodeId)) throw new Error('Invalid Konta2r node id');
      const body = await post('node-lifecycle', { nodeId, action });
      const node = parseNode(body);
      if (node.nodeId !== nodeId) throw new Error('Node lifecycle response identity mismatch');

      if (action === 'rotate') {
        return await persistReturnedCredential(body, node);
      }
      if (action === 'revoke') {
        try {
          await options.vault.delete(nodeId);
        } catch {
          // Server revocation is already authoritative, but stale encrypted local
          // material should still be treated as a cleanup failure to be retried.
          throw new Error('Revoked node credential could not be removed locally');
        }
      }
      return node;
    },
  };
}
