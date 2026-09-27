#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { chromium } from 'playwright';

const BASE_URL = process.argv[2] ?? 'http://127.0.0.1:4174';
const OUTPUT_PATH = process.argv[3]
  ?? 'docs/benchmarks/evidence/relateanything-vits16plus-browser-smoke.json';

async function runBackend(backend) {
  const consoleMessages = [];
  const pageErrors = [];
  const launchArgs = ['--disable-dev-shm-usage'];

  if (backend === 'webgpu') {
    launchArgs.push(
      '--enable-unsafe-webgpu',
      '--enable-features=Vulkan',
    );
  }

  let browser = null;
  try {
    browser = await chromium.launch({
      headless: true,
      args: launchArgs,
    });
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on('console', (message) => {
      consoleMessages.push({
        type: message.type(),
        text: message.text(),
      });
    });
    page.on('pageerror', (error) => {
      pageErrors.push(error.message);
    });

    const url = `${BASE_URL}/tools/relateanything-browser-smoke/index.html?backend=${backend}`;
    const startedAt = Date.now();
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 120_000,
    });
    await page.waitForFunction(
      () => window.__RELATEANYTHING_SMOKE_RESULT__ !== undefined,
      undefined,
      { timeout: 240_000 },
    );
    const result = await page.evaluate(
      () => window.__RELATEANYTHING_SMOKE_RESULT__,
    );
    const browserVersion = await browser.version();

    return {
      backend,
      harnessCompleted: true,
      harnessDurationMs: Date.now() - startedAt,
      browserVersion,
      launchArgs,
      consoleMessages,
      pageErrors,
      result,
    };
  } catch (error) {
    return {
      backend,
      harnessCompleted: false,
      browserVersion: browser ? await browser.version().catch(() => null) : null,
      launchArgs,
      consoleMessages,
      pageErrors,
      error: error instanceof Error ? error.message : String(error),
      result: null,
    };
  } finally {
    if (browser) await browser.close();
  }
}

const wasm = await runBackend('wasm');
const webgpu = await runBackend('webgpu');

const evidence = {
  schemaVersion: '1',
  recordType: 'relateanything_browser_runtime_smoke',
  candidateId: 'maelic/relsgg-vits16plus',
  executedAtIso: new Date().toISOString(),
  runner: {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    baseUrl: BASE_URL,
  },
  wasm,
  webgpu,
  gates: {
    wasmRequired: true,
    wasmPassed: Boolean(wasm.result?.passed),
    webgpuRequired: false,
    webgpuPassed: Boolean(webgpu.result?.passed),
    webgpuDiagnostic:
      webgpu.result?.passed
        ? 'verified'
        : webgpu.result?.error?.startsWith('webgpu_unavailable')
          ? 'unavailable_on_runner'
          : webgpu.harnessCompleted
            ? 'runtime_failed'
            : 'browser_harness_failed',
  },
};

await mkdir(dirname(OUTPUT_PATH), { recursive: true });
await writeFile(OUTPUT_PATH, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(evidence, null, 2));

if (!evidence.gates.wasmPassed) process.exitCode = 1;
