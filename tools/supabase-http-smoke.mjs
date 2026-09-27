#!/usr/bin/env node

/**
 * Non-destructive smoke probe for a deployed Konta2r Supabase project.
 *
 * Required environment variables:
 *   KONTA2R_E2E_SUPABASE_URL=https://<project-ref>.supabase.co
 *   KONTA2R_E2E_PUBLISHABLE_KEY=sb_publishable_...
 *
 * This probe intentionally uses no human JWT and no node credential. It checks
 * that the two human-admin functions reject unauthenticated callers and that the
 * custom sensor endpoint reaches Konta2r policy code and rejects missing sensor
 * authentication. It never creates rows or uploads an accepted aggregate.
 */

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function normalizeProjectUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error('Supabase smoke URL must use HTTPS except for local development');
  }
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

const projectUrl = normalizeProjectUrl(required('KONTA2R_E2E_SUPABASE_URL'));
const publishableKey = required('KONTA2R_E2E_PUBLISHABLE_KEY');
if (publishableKey.startsWith('sb_secret_')) {
  throw new Error('Refusing to use a Supabase secret key in a client-style smoke probe');
}

async function request(functionName, init) {
  return fetch(`${projectUrl}/functions/v1/${functionName}`, {
    redirect: 'error',
    ...init,
  });
}

async function jsonOrText(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function expectStatus(label, actual, accepted) {
  if (!accepted.includes(actual)) {
    throw new Error(`${label}: expected ${accepted.join(' or ')}, received ${actual}`);
  }
}

async function checkHumanFunction(name, body) {
  const response = await request(name, {
    method: 'POST',
    headers: {
      apikey: publishableKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  // Depending on the project gateway/JWT signing generation, rejection can be
  // produced by the platform or by Konta2r's defense-in-depth Auth helper.
  expectStatus(`${name} unauthenticated`, response.status, [401]);
  return { name, status: response.status, body: await jsonOrText(response) };
}

function provisionalQuality() {
  const dimensions = {
    detection: { value: 0.9, weight: 0.2, applicable: true },
    tracking: { value: 0.9, weight: 0.2, applicable: true },
    geometry: { value: 0, weight: 0.1, applicable: false },
    temporal: { value: 0.9, weight: 0.15, applicable: true },
    device: { value: 0.9, weight: 0.15, applicable: true },
    validation: { value: 0, weight: 0.15, applicable: false },
    consistency: { value: 0, weight: 0.05, applicable: false },
  };
  return {
    methodVersion: '0.1',
    overall: 0.9,
    status: 'provisional',
    dimensions,
    warnings: ['ground_truth_validation_missing', 'network_consistency_not_estimated'],
  };
}

async function checkSensorBoundary() {
  const now = Date.now();
  const nodeId = 'node_smoke01';
  const sequence = 1;
  const envelope = {
    schemaVersion: '2.0',
    nodeId,
    sequence,
    generatedAtIso: new Date(now - 60_000).toISOString(),
    observedSegment: { segmentId: 'segment_smoke01', source: 'konta2r' },
    softwareVersion: '2.0.0-alpha.1',
    methodologyVersion: '2.0',
    modelFingerprint: 'sha256:smoke-not-a-production-model',
    quality: provisionalQuality(),
    runtime: {
      uptimeRatio: 0.99,
      inferenceFpsP50: 5,
      inferenceLatencyP95Ms: 200,
      runtimeBackend: 'wasm',
    },
    records: [{
      schemaVersion: '2.0',
      aggregateType: 'flow',
      bucketStartMs: now - 10 * 60_000,
      bucketEndMs: now - 5 * 60_000,
      entityType: 'cyclist',
      direction: 'A_TO_B',
      count: 3,
      meanQuality: 0.9,
    }],
  };

  const response = await request('ingest-community', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': `${nodeId}:${sequence}`,
    },
    body: JSON.stringify(envelope),
  });
  expectStatus('ingest-community missing sensor auth', response.status, [401]);
  const body = await jsonOrText(response);
  if (typeof body === 'object' && body !== null && body.code !== 'invalid_node_auth') {
    throw new Error(`ingest-community: expected invalid_node_auth, received ${JSON.stringify(body)}`);
  }
  return { name: 'ingest-community', status: response.status, body };
}

async function main() {
  const results = [];
  results.push(await checkHumanFunction('node-enroll', {
    label: 'smoke',
    segmentId: 'segment_smoke01',
  }));
  results.push(await checkHumanFunction('node-lifecycle', {
    nodeId: 'node_smoke01',
    action: 'pause',
  }));
  results.push(await checkSensorBoundary());

  console.log(JSON.stringify({
    ok: true,
    projectUrl,
    checks: results,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
