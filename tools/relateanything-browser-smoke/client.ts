type Backend = 'wasm' | 'webgpu';

interface PredicateBankSubset {
  names: string[];
  dim: number;
  W: number[][];
  alpha: number[];
}

interface BrowserSmokeResult {
  schemaVersion: '1';
  backend: Backend;
  attempted: boolean;
  passed: boolean;
  startedAtIso: string;
  completedAtIso: string;
  environment: {
    userAgent: string;
    crossOriginIsolated: boolean;
    hardwareConcurrency: number | null;
    deviceMemoryGiB: number | null;
    navigatorGpuAvailable: boolean;
  };
  artifact: {
    modelBytes: number;
    vocabularySize: number;
    textDim: number;
  };
  session: {
    creationMs: number | null;
    inferenceMs: number | null;
    inputNames: string[];
    outputNames: string[];
  };
  outputs: Array<{
    name: string;
    type: string;
    shape: Array<number | string>;
    dataLength: number;
    nonFiniteCount: number;
    min: number | null;
    max: number | null;
  }>;
  stages: Array<{ name: string; elapsedMs: number }>;
  findings: string[];
  error: string | null;
}

declare global {
  interface Window {
    __RELATEANYTHING_SMOKE_RESULT__?: BrowserSmokeResult;
  }
  interface Navigator {
    deviceMemory?: number;
    gpu?: unknown;
  }
}

function outputSummary(name: string, value: {
  type?: unknown;
  dims?: readonly (number | string)[];
  data?: ArrayLike<number | bigint | boolean>;
}) {
  const data = value.data;
  let nonFiniteCount = 0;
  let finiteCount = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  if (data) {
    for (let index = 0; index < data.length; index += 1) {
      const numeric = Number(data[index]);
      if (!Number.isFinite(numeric)) {
        nonFiniteCount += 1;
        continue;
      }
      finiteCount += 1;
      min = Math.min(min, numeric);
      max = Math.max(max, numeric);
    }
  }

  return {
    name,
    type: String(value.type ?? 'unknown'),
    shape: [...(value.dims ?? [])],
    dataLength: data?.length ?? -1,
    nonFiniteCount,
    min: finiteCount > 0 ? min : null,
    max: finiteCount > 0 ? max : null,
  };
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label}_timeout_after_${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function makeBankTensors(
  ort: typeof import('onnxruntime-web'),
  bank: PredicateBankSubset,
) {
  if (bank.names.length === 0) throw new Error('predicate bank subset is empty');
  if (bank.W.length !== bank.names.length || bank.alpha.length !== bank.names.length) {
    throw new Error('predicate bank subset row counts do not match');
  }

  const flattened = new Float32Array(bank.names.length * bank.dim);
  bank.W.forEach((row, rowIndex) => {
    if (row.length !== bank.dim) {
      throw new Error(`predicate bank row ${rowIndex} has invalid dimension`);
    }
    flattened.set(row, rowIndex * bank.dim);
  });

  return {
    W: new ort.Tensor('float32', flattened, [bank.names.length, bank.dim]),
    alpha: new ort.Tensor(
      'float32',
      Float32Array.from(bank.alpha),
      [bank.names.length],
    ),
  };
}

async function execute(): Promise<BrowserSmokeResult> {
  const params = new URLSearchParams(window.location.search);
  const backend = params.get('backend') === 'webgpu' ? 'webgpu' : 'wasm';
  const startedAtIso = new Date().toISOString();
  const findings: string[] = [];
  const stages: BrowserSmokeResult['stages'] = [];
  const stageStartedAt = performance.now();
  const stage = (name: string) => {
    const elapsedMs = Math.max(0, performance.now() - stageStartedAt);
    stages.push({ name, elapsedMs });
    console.info(`relateanything_smoke_stage:${name}:${Math.round(elapsedMs)}ms`);
  };
  const outputsSummary: BrowserSmokeResult['outputs'] = [];
  let modelBytes = 0;
  let vocabularySize = 0;
  let textDim = 0;
  let creationMs: number | null = null;
  let inferenceMs: number | null = null;
  let inputNames: string[] = [];
  let outputNames: string[] = [];
  let error: string | null = null;

  try {
    stage('start');
    const ort = backend === 'webgpu'
      ? await import('onnxruntime-web/webgpu')
      : await import('onnxruntime-web');

    stage('ort_imported');
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    ort.env.wasm.wasmPaths = '/ort/';

    if (backend === 'webgpu' && !navigator.gpu) {
      throw new Error('webgpu_unavailable:navigator.gpu is absent');
    }

    stage('fetch_start');
    const [modelResponse, bankResponse] = await Promise.all([
      fetch('/relateanything-smoke/relateanything.onnx'),
      fetch('/relateanything-smoke/public-life-bank.json'),
    ]);
    if (!modelResponse.ok) {
      throw new Error(`model_fetch_failed:${modelResponse.status}`);
    }
    if (!bankResponse.ok) {
      throw new Error(`bank_fetch_failed:${bankResponse.status}`);
    }

    const model = new Uint8Array(await modelResponse.arrayBuffer());
    const bank = await bankResponse.json() as PredicateBankSubset;
    stage('artifacts_loaded');
    modelBytes = model.byteLength;
    vocabularySize = bank.names.length;
    textDim = bank.dim;

    const createStarted = performance.now();
    stage('session_create_start');
    const session = await withTimeout(
      ort.InferenceSession.create(model, {
        executionProviders: [backend],
      }),
      backend === 'wasm' ? 240_000 : 120_000,
      `${backend}_session_create`,
    );
    creationMs = Math.max(0, performance.now() - createStarted);
    stage('session_created');

    try {
      inputNames = [...session.inputNames];
      outputNames = [...session.outputNames];

      const requiredInputs = ['image', 'boxes', 'box_counts', 'W', 'alpha'];
      const requiredOutputs = [
        'pred_logits',
        'pair_logits',
        'sub_idx',
        'obj_idx',
        'valid_mask',
      ];
      for (const name of requiredInputs) {
        if (!inputNames.includes(name)) findings.push(`missing_input:${name}`);
      }
      for (const name of requiredOutputs) {
        if (!outputNames.includes(name)) findings.push(`missing_output:${name}`);
      }

      const image = new Float32Array(1 * 3 * 448 * 448);
      image.fill(0.5);
      const boxes = new Float32Array(1 * 32 * 4);
      boxes.set([0.35, 0.5, 0.18, 0.55], 0);
      boxes.set([0.52, 0.68, 0.42, 0.18], 4);
      const bankTensors = makeBankTensors(ort, bank);

      const feeds = {
        image: new ort.Tensor('float32', image, [1, 3, 448, 448]),
        boxes: new ort.Tensor('float32', boxes, [1, 32, 4]),
        box_counts: new ort.Tensor('int64', BigInt64Array.from([2n]), [1]),
        W: bankTensors.W,
        alpha: bankTensors.alpha,
      };

      let outputs: Record<string, {
        type?: unknown;
        dims?: readonly (number | string)[];
        data?: ArrayLike<number | bigint | boolean>;
        dispose?: () => void;
      }>;
      const inferenceStarted = performance.now();
      try {
        stage('inference_start');
        outputs = await withTimeout(
          session.run(feeds) as Promise<typeof outputs>,
          backend === 'wasm' ? 120_000 : 90_000,
          `${backend}_inference`,
        );
        inferenceMs = Math.max(0, performance.now() - inferenceStarted);
        stage('inference_complete');
      } finally {
        Object.values(feeds).forEach((tensor) => tensor.dispose());
      }

      for (const name of outputNames) {
        const value = outputs[name];
        if (!value) {
          findings.push(`missing_runtime_output:${name}`);
          continue;
        }
        const summary = outputSummary(name, value);
        outputsSummary.push(summary);
        if (summary.nonFiniteCount > 0) {
          findings.push(`non_finite_output:${name}:${summary.nonFiniteCount}`);
        }
        value.dispose?.();
      }
    } finally {
      await session.release();
    }
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
    findings.push(`runtime_error:${error}`);
  }

  return {
    schemaVersion: '1',
    backend,
    attempted: true,
    passed: error === null && findings.length === 0,
    startedAtIso,
    completedAtIso: new Date().toISOString(),
    environment: {
      userAgent: navigator.userAgent,
      crossOriginIsolated: window.crossOriginIsolated,
      hardwareConcurrency: Number.isFinite(navigator.hardwareConcurrency)
        ? navigator.hardwareConcurrency
        : null,
      deviceMemoryGiB: Number.isFinite(navigator.deviceMemory)
        ? navigator.deviceMemory ?? null
        : null,
      navigatorGpuAvailable: Boolean(navigator.gpu),
    },
    artifact: {
      modelBytes,
      vocabularySize,
      textDim,
    },
    session: {
      creationMs,
      inferenceMs,
      inputNames,
      outputNames,
    },
    outputs: outputsSummary,
    stages,
    findings,
    error,
  };
}

const result = await execute();
window.__RELATEANYTHING_SMOKE_RESULT__ = result;
const target = document.querySelector<HTMLPreElement>('#result');
if (target) target.textContent = JSON.stringify(result, null, 2);
document.title = result.passed
  ? `PASS — ${result.backend}`
  : `FAIL — ${result.backend}`;
