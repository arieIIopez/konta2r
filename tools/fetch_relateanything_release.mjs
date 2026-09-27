#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

const MODEL_REPO = process.argv[2] ?? 'maelic/relsgg-vits16';
const OUTPUT_DIR = process.argv[3] ?? '.cache/relateanything/relsgg-vits16';
const API_URL = `https://huggingface.co/api/models/${MODEL_REPO}?blobs=true`;

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function encodedRepoPath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

async function fetchBytes(url, label) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: { 'user-agent': 'konta2r-relateanything-smoke/1.0' },
  });
  if (!response.ok) {
    throw new Error(`${label} download failed: HTTP ${response.status} (${url})`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  return {
    bytes,
    finalUrl: response.url,
    etag: response.headers.get('etag'),
    contentLengthHeader: response.headers.get('content-length'),
    contentType: response.headers.get('content-type'),
  };
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  const apiResponse = await fetch(API_URL, {
    headers: { 'user-agent': 'konta2r-relateanything-smoke/1.0' },
  });
  if (!apiResponse.ok) {
    throw new Error(`Hugging Face model API failed: HTTP ${apiResponse.status}`);
  }
  const api = await apiResponse.json();
  const siblings = Array.isArray(api.siblings) ? api.siblings : [];
  const names = siblings
    .map((item) => item?.rfilename)
    .filter((value) => typeof value === 'string');

  const required = [
    'relateanything.onnx',
    'predicate_bank.npz',
    'thresholds.json',
    'calibration.json',
  ];
  const missing = required.filter((name) => !names.includes(name));
  if (missing.length > 0) {
    throw new Error(`Release is missing required files: ${missing.join(', ')}`);
  }

  const externalCandidates = names.filter((name) => {
    if (name === 'relateanything.onnx') return false;
    const lower = name.toLowerCase();
    return lower.includes('relateanything')
      && (
        lower.includes('.onnx.')
        || lower.endsWith('.data')
        || lower.endsWith('.bin')
        || lower.includes('chunk')
      );
  });

  const releaseFiles = [...required, ...externalCandidates];
  const artifacts = [];

  for (const name of releaseFiles) {
    const url = `https://huggingface.co/${MODEL_REPO}/resolve/main/${encodedRepoPath(name)}?download=true`;
    const downloaded = await fetchBytes(url, name);
    const target = join(OUTPUT_DIR, basename(name));
    await writeFile(target, downloaded.bytes);
    const sibling = siblings.find((item) => item?.rfilename === name) ?? {};
    artifacts.push({
      name,
      localPath: target,
      sourceUrl: url,
      finalHost: (() => {
        try { return new URL(downloaded.finalUrl).host; } catch { return null; }
      })(),
      sha256: sha256(downloaded.bytes),
      sizeBytes: downloaded.bytes.byteLength,
      etag: downloaded.etag,
      contentLengthHeader: downloaded.contentLengthHeader,
      contentType: downloaded.contentType,
      huggingFaceBlobId: sibling.blobId ?? null,
      huggingFaceLfs: sibling.lfs ?? null,
    });
  }

  const bundleName = MODEL_REPO.split('/').at(-1);
  const provenanceUrl =
    `https://raw.githubusercontent.com/Maelic/RelateAnything/main/deploy/dist/${bundleName}/relateanything.json`;
  let provenance = null;
  try {
    const downloaded = await fetchBytes(provenanceUrl, 'upstream provenance');
    const target = join(OUTPUT_DIR, 'relateanything.json');
    await writeFile(target, downloaded.bytes);
    provenance = {
      name: 'relateanything.json',
      localPath: target,
      sourceUrl: provenanceUrl,
      finalUrl: downloaded.finalUrl,
      sha256: sha256(downloaded.bytes),
      sizeBytes: downloaded.bytes.byteLength,
      etag: downloaded.etag,
      contentType: downloaded.contentType,
    };
  } catch (error) {
    provenance = {
      name: 'relateanything.json',
      localPath: null,
      sourceUrl: provenanceUrl,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const manifest = {
    schemaVersion: '1',
    recordType: 'relateanything_release_fetch',
    modelRepo: MODEL_REPO,
    modelRevision: api.sha ?? null,
    modelLastModified: api.lastModified ?? null,
    fetchedAtIso: new Date().toISOString(),
    apiUrl: API_URL,
    siblingCount: names.length,
    siblingNames: names.sort(),
    externalDataCandidates: externalCandidates.sort(),
    artifacts,
    provenance,
  };

  const manifestPath = join(OUTPUT_DIR, 'release-fetch.json');
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(manifest, null, 2));
}

await main();
