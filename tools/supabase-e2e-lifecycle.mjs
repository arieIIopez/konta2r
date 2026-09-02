#!/usr/bin/env node

/**
 * Destructive-but-contained E2E probe for a dedicated Konta2r pilot project.
 *
 * It creates one disposable node and intentionally leaves its append-only audit
 * evidence plus accepted aggregate batches in the test project. The node is
 * revoked at the end. No raw node credential or human JWT is printed.
 *
 * Required environment variables:
 *   KONTA2R_E2E_SUPABASE_URL=https://<project-ref>.supabase.co
 *   KONTA2R_E2E_PUBLISHABLE_KEY=sb_publishable_...
 *   KONTA2R_E2E_USER_JWT=<short-lived Supabase Auth user access token>
 *   KONTA2R_E2E_SEGMENT_ID=<pre-created public.segments row>
 *
 * Optional:
 *   KONTA2R_E2E_SEGMENT_SOURCE=konta2r
 */

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function normalizeProjectUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error('Supabase E2E URL must use HTTPS except for local development');
  }
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

const projectUrl = normalizeProjectUrl(required('KONTA2R_E2E_SUPABASE_URL'));
const publishableKey = required('KONTA2R_E2E_PUBLISHABLE_KEY');
const userJwt = required('KONTA2R_E2E_USER_JWT');
const segmentId = required('KONTA2R_E2E_SEGMENT_ID');
const segmentSource = process.env.KONTA2R_E2E_SEGMENT_SOURCE?.trim() || 'konta2r';

if (publishableKey.startsWith('sb_secret_')) {
  throw new Error('Refusing to use a Supabase secret key in a client E2E probe');
}
if (!/^eyJ[^.]*\.[^.]+\.[^.]+$/.test(userJwt)) {
  throw new Error('KONTA2R_E2E_USER_JWT does not look like a JWT');
}
if (!['osm', 'konta2r', 'municipal', 'other'].includes(segmentSource)) {
  throw new Error('Invalid KONTA2R_E2E_SEGMENT_SOURCE');
}

function humanHeaders() {
  return {
    apikey: publishableKey,
    authorization: `Bearer ${userJwt}`,
    'content-type': 'application/json',
  };
}

async function invoke(name, init) {
  return fetch(`${projectUrl}/functions/v1/${name}`, {
    redirect: 'error',
    ...init,
  });
}

async function json(response) {
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`Expected JSON from ${response.url}, received ${text.slice(0, 160)}`);
  }
  return body;
}

async function expectJson(name, response, acceptedStatuses) {
  const body = await json(response);
  if (!acceptedStatuses.includes(response.status)) {
    throw new Error(`${name}: HTTP ${response.status} ${JSON.stringify(body)}`);
  }
  return body;
}

function provisionalQuality() {
  return {
    methodVersion: '0.1',
    overall: 0.9,
    status: 'provisional',
    dimensions: {
      detection: { value: 0.9, weight: 0.2, applicable: true },
      tracking: { value: 0.9, weight: 0.2, applicable: true },
      geometry: { value: 0, weight: 0.1, applicable: false },
      temporal: { value: 0.9, weight: 0.15, applicable: true },
      device: { value: 0.9, weight: 0.15, applicable: true },
      validation: { value: 0, weight: 0.15, applicable: false },
      consistency: { value: 0, weight: 0.05, applicable: false },
    },
    warnings: ['ground_truth_validation_missing', 'network_consistency_not_estimated'],
  };
}

function envelope(nodeId, sequence, count = 3) {
  const now = Date.now();
  return {
    schemaVersion: '2.0',
    nodeId,
    sequence,
    generatedAtIso: new Date(now - 30_000).toISOString(),
    observedSegment: { segmentId, source: segmentSource },
    softwareVersion: '2.0.0-alpha.1',
    methodologyVersion: '2.0',
    modelFingerprint: 'sha256:e2e-synthetic-not-production',
    quality: provisionalQuality(),
    runtime: {
      uptimeRatio: 0.99,
      inferenceFpsP50: 5,
      inferenceLatencyP95Ms: 180,
      droppedFrameRatio: 0.01,
      runtimeBackend: 'wasm',
    },
    records: [{
      schemaVersion: '2.0',
      aggregateType: 'flow',
      bucketStartMs: now - 10 * 60_000,
      bucketEndMs: now - 5 * 60_000,
      entityType: 'cyclist',
      direction: 'A_TO_B',
      count,
      meanQuality: 0.9,
    }],
  };
}

async function lifecycle(nodeId, action) {
  const response = await invoke('node-lifecycle', {
    method: 'POST',
    headers: humanHeaders(),
    body: JSON.stringify({ nodeId, action }),
  });
  return expectJson(`node-lifecycle:${action}`, response, [200]);
}

async function ingest(nodeId, credential, sequence, count = 3) {
  const body = envelope(nodeId, sequence, count);
  const response = await invoke('ingest-community', {
    method: 'POST',
    headers: {
      authorization: `Konta2rNode ${credential}`,
      'content-type': 'application/json',
      'idempotency-key': `${nodeId}:${sequence}`,
    },
    body: JSON.stringify(body),
  });
  return { response, body };
}

async function main() {
  const label = `E2E disposable ${new Date().toISOString()}`;
  const enrollResponse = await invoke('node-enroll', {
    method: 'POST',
    headers: humanHeaders(),
    body: JSON.stringify({ label, segmentId }),
  });
  const enrolled = await expectJson('node-enroll', enrollResponse, [201]);
  const nodeId = enrolled?.node?.nodeId;
  let credential = enrolled?.credential;
  if (typeof nodeId !== 'string' || typeof credential !== 'string') {
    throw new Error('node-enroll response omitted nodeId or one-time credential');
  }

  const checks = [];
  checks.push({ step: 'enroll', status: enrollResponse.status, nodeStatus: enrolled.node.status });

  const activated = await lifecycle(nodeId, 'activate');
  checks.push({ step: 'activate', status: 200, nodeStatus: activated.node.status });

  const first = await ingest(nodeId, credential, 1, 3);
  const firstBody = await expectJson('ingest:first', first.response, [202]);
  checks.push({ step: 'ingest', status: first.response.status, code: firstBody.code });

  const replayResponse = await invoke('ingest-community', {
    method: 'POST',
    headers: {
      authorization: `Konta2rNode ${credential}`,
      'content-type': 'application/json',
      'idempotency-key': `${nodeId}:1`,
    },
    body: JSON.stringify(first.body),
  });
  const replay = await expectJson('ingest:replay', replayResponse, [200]);
  checks.push({ step: 'idempotent replay', status: replayResponse.status, code: replay.code });

  const conflictResponse = await invoke('ingest-community', {
    method: 'POST',
    headers: {
      authorization: `Konta2rNode ${credential}`,
      'content-type': 'application/json',
      'idempotency-key': `${nodeId}:1`,
    },
    body: JSON.stringify({ ...first.body, records: [{ ...first.body.records[0], count: 4 }] }),
  });
  const conflict = await expectJson('ingest:sequence-conflict', conflictResponse, [409]);
  checks.push({ step: 'sequence conflict', status: conflictResponse.status, code: conflict.code });

  const rotated = await lifecycle(nodeId, 'rotate');
  const rotatedCredential = rotated.credential;
  if (typeof rotatedCredential !== 'string' || rotatedCredential === credential) {
    throw new Error('credential rotation did not return distinct one-time credential material');
  }
  checks.push({ step: 'rotate', status: 200, nodeStatus: rotated.node.status });

  const staleCredential = await ingest(nodeId, credential, 2, 3);
  const staleBody = await expectJson('ingest:stale-credential', staleCredential.response, [401]);
  checks.push({ step: 'old credential rejected', status: staleCredential.response.status, code: staleBody.code });
  credential = rotatedCredential;

  const rotatedIngest = await ingest(nodeId, credential, 2, 3);
  const rotatedIngestBody = await expectJson('ingest:rotated-credential', rotatedIngest.response, [202]);
  checks.push({ step: 'new credential accepted', status: rotatedIngest.response.status, code: rotatedIngestBody.code });

  const paused = await lifecycle(nodeId, 'pause');
  checks.push({ step: 'pause', status: 200, nodeStatus: paused.node.status });
  const pausedIngest = await ingest(nodeId, credential, 3, 3);
  const pausedBody = await expectJson('ingest:paused-node', pausedIngest.response, [403]);
  checks.push({ step: 'paused node rejected', status: pausedIngest.response.status, code: pausedBody.code });

  const reactivated = await lifecycle(nodeId, 'activate');
  checks.push({ step: 'reactivate', status: 200, nodeStatus: reactivated.node.status });
  const resumed = await ingest(nodeId, credential, 3, 3);
  const resumedBody = await expectJson('ingest:reactivated-node', resumed.response, [202]);
  checks.push({ step: 'reactivated node accepted', status: resumed.response.status, code: resumedBody.code });

  const revoked = await lifecycle(nodeId, 'revoke');
  checks.push({ step: 'revoke', status: 200, nodeStatus: revoked.node.status });
  const revokedIngest = await ingest(nodeId, credential, 4, 3);
  const revokedBody = await expectJson('ingest:revoked-node', revokedIngest.response, [401]);
  checks.push({ step: 'revoked node rejected', status: revokedIngest.response.status, code: revokedBody.code });

  credential = '<redacted>';
  console.log(JSON.stringify({
    ok: true,
    projectUrl,
    nodeId,
    segmentId,
    finalStatus: revoked.node.status,
    checks,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
