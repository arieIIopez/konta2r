import * as ort from 'onnxruntime-web/webgpu';
import type { DetectorBackend, DetectorRuntimeMetadata } from '../types';

export const ONNX_RUNTIME_WEB_VERSION = '1.29.0';

export type OnnxExecutionProvider = 'webgpu' | 'wasm';
export type OnnxModelSource = string | Uint8Array;
export type OnnxValueMap = Record<string, unknown>;

export interface OnnxSessionLike {
  run(feeds: OnnxValueMap): Promise<OnnxValueMap>;
  release(): Promise<void> | void;
  readonly inputNames?: readonly string[];
  readonly outputNames?: readonly string[];
}

export interface OnnxSessionFactory {
  create(
    source: OnnxModelSource,
    executionProviders: readonly OnnxExecutionProvider[],
  ): Promise<OnnxSessionLike>;
}

export interface OnnxRuntimeCapabilities {
  webgpu: boolean;
}

export interface OnnxSessionSelection {
  session: OnnxSessionLike;
  runtime: DetectorRuntimeMetadata;
  webgpuAttempted: boolean;
  fallbackReason?: string;
}

function normalizedError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function detectOnnxRuntimeCapabilities(
  candidate: Navigator | undefined = typeof navigator === 'undefined' ? undefined : navigator,
): OnnxRuntimeCapabilities {
  return { webgpu: Boolean(candidate && 'gpu' in candidate) };
}

class BrowserOnnxSession implements OnnxSessionLike {
  constructor(private readonly session: ort.InferenceSession) {}

  get inputNames(): readonly string[] {
    return this.session.inputNames;
  }

  get outputNames(): readonly string[] {
    return this.session.outputNames;
  }

  async run(feeds: OnnxValueMap): Promise<OnnxValueMap> {
    const outputs = await this.session.run(feeds as Record<string, ort.Tensor>);
    return outputs as unknown as OnnxValueMap;
  }

  release(): Promise<void> {
    return this.session.release();
  }
}

export class BrowserOnnxSessionFactory implements OnnxSessionFactory {
  async create(
    source: OnnxModelSource,
    executionProviders: readonly OnnxExecutionProvider[],
  ): Promise<OnnxSessionLike> {
    const options: ort.InferenceSession.SessionOptions = {
      executionProviders: [...executionProviders],
    };
    const session = typeof source === 'string'
      ? await ort.InferenceSession.create(source, options)
      : await ort.InferenceSession.create(source, options);
    return new BrowserOnnxSession(session);
  }
}

function runtimeMetadata(
  backend: DetectorBackend,
  executionProviders: OnnxExecutionProvider[],
): DetectorRuntimeMetadata {
  return {
    runtime: 'onnxruntime-web',
    runtimeVersion: ONNX_RUNTIME_WEB_VERSION,
    backend,
    executionProviders,
  };
}

/**
 * WebGPU is attempted only when the browser exposes it. Session creation is
 * retried with WASM-only when WebGPU initialization or model compatibility
 * fails, allowing old/unsupported devices to remain valid Konta2r nodes.
 */
export async function createOnnxSessionWithFallback(
  source: OnnxModelSource,
  options: {
    capabilities?: OnnxRuntimeCapabilities;
    factory?: OnnxSessionFactory;
    preferWebGpu?: boolean;
  } = {},
): Promise<OnnxSessionSelection> {
  const factory = options.factory ?? new BrowserOnnxSessionFactory();
  const capabilities = options.capabilities ?? detectOnnxRuntimeCapabilities();
  const shouldTryWebGpu = (options.preferWebGpu ?? true) && capabilities.webgpu;

  if (shouldTryWebGpu) {
    try {
      const providers: OnnxExecutionProvider[] = ['webgpu', 'wasm'];
      const session = await factory.create(source, providers);
      return {
        session,
        runtime: runtimeMetadata('webgpu', providers),
        webgpuAttempted: true,
      };
    } catch (error) {
      const fallbackReason = normalizedError(error);
      const providers: OnnxExecutionProvider[] = ['wasm'];
      const session = await factory.create(source, providers);
      return {
        session,
        runtime: runtimeMetadata('wasm', providers),
        webgpuAttempted: true,
        fallbackReason,
      };
    }
  }

  const providers: OnnxExecutionProvider[] = ['wasm'];
  const session = await factory.create(source, providers);
  return {
    session,
    runtime: runtimeMetadata('wasm', providers),
    webgpuAttempted: false,
  };
}

export async function disposeOnnxValues(values: OnnxValueMap): Promise<void> {
  const disposed = new Set<object>();
  for (const value of Object.values(values)) {
    if (!value || typeof value !== 'object' || disposed.has(value)) continue;
    disposed.add(value);
    const candidate = value as { dispose?: () => void | Promise<void> };
    if (typeof candidate.dispose === 'function') await candidate.dispose();
  }
}
