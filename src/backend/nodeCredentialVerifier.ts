import {
  isValidNodeCredential,
  isValidNodeId,
  verifyNodeCredentialHmac,
} from './nodeCredential';
import type {
  NodeCredentialRowLookup,
  NodeCredentialVerifier,
} from './communityIngestion';

export interface NodePepperProvider {
  getPepper(keyVersion: number): Promise<string | Uint8Array> | string | Uint8Array;
}

/**
 * Production-oriented node verifier.
 *
 * Invalid credentials, unknown nodes and inactive/revoked/expired rows all
 * collapse to the same public authorization result. Infrastructure failures
 * (database/secret manager unavailable) are allowed to throw so the HTTP layer
 * can return a generic 5xx instead of misreporting an operational fault as a
 * credential problem.
 */
export function createCryptographicNodeCredentialVerifier(
  lookup: NodeCredentialRowLookup,
  pepperProvider: NodePepperProvider,
  nowMs: () => number = Date.now,
): NodeCredentialVerifier {
  return async (nodeId, credential) => {
    if (!isValidNodeId(nodeId) || !isValidNodeCredential(credential)) {
      return { authorized: false };
    }

    const row = await lookup(nodeId);
    if (
      row === undefined
      || row.nodeId !== nodeId
      || row.nodeStatus !== 'active'
      || row.revokedAtMs !== undefined
      || (row.expiresAtMs !== undefined && row.expiresAtMs <= nowMs())
      || !/^[a-f0-9]{64}$/.test(row.credentialHmac)
      || !Number.isInteger(row.keyVersion)
      || row.keyVersion < 1
    ) {
      return { authorized: false };
    }

    const pepper = await pepperProvider.getPepper(row.keyVersion);
    const verified = await verifyNodeCredentialHmac(
      credential,
      row.credentialHmac,
      pepper,
    );
    if (!verified) return { authorized: false };

    return {
      authorized: true,
      node: {
        nodeId: row.nodeId,
        segmentId: row.segmentId,
      },
    };
  };
}
