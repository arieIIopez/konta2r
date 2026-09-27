import type { DetectorRuntimeMetadata } from '../types';
import {
  createOnnxSessionWithFallback,
  type OnnxModelSource,
  type OnnxRuntimeCapabilities,
  type OnnxSessionFactory,
  type OnnxValueMetadata,
} from './runtime';

export interface OnnxModelProbeResult {
  runtime: DetectorRuntimeMetadata;
  webgpuAttempted: boolean;
  fallbackReason?: string;
  inputs: OnnxValueMetadata[];
  outputs: OnnxValueMetadata[];
}

function metadataOrNames(
  metadata: readonly OnnxValueMetadata[] | undefined,
  names: readonly string[] | undefined,
): OnnxValueMetadata[] {
  if (metadata && metadata.length > 0) {
    return metadata.map((value) => ({
      ...value,
      ...(value.shape === undefined ? {} : { shape: [...value.shape] }),
    }));
  }
  return (names ?? []).map((name) => ({ name, kind: 'unknown' }));
}

/**
 * Loads an ONNX model only long enough to read the runtime-declared IO
 * contract, then releases the session. This is used before implementing a
 * model-specific codec so tensor names/shapes are observed rather than guessed.
 */
export async function probeOnnxModel(
  source: OnnxModelSource,
  options: {
    capabilities?: OnnxRuntimeCapabilities;
    factory?: OnnxSessionFactory;
    preferWebGpu?: boolean;
  } = {},
): Promise<OnnxModelProbeResult> {
  const selection = await createOnnxSessionWithFallback(source, options);
  try {
    const result: OnnxModelProbeResult = {
      runtime: {
        ...selection.runtime,
        executionProviders: [...selection.runtime.executionProviders],
      },
      webgpuAttempted: selection.webgpuAttempted,
      inputs: metadataOrNames(selection.session.inputMetadata, selection.session.inputNames),
      outputs: metadataOrNames(selection.session.outputMetadata, selection.session.outputNames),
    };
    if (selection.fallbackReason !== undefined) result.fallbackReason = selection.fallbackReason;
    return result;
  } finally {
    await selection.session.release();
  }
}
