import type { RawDetection } from '../core/types';

export type DetectorBackend = 'webgpu' | 'wasm' | 'webnn' | 'webgl' | 'unknown';

export interface DetectorModelMetadata {
  adapterId: string;
  modelId: string;
  modelVersion: string;
  modelSha256?: string;
  sourceUrl?: string;
  codeLicense?: string;
  weightsLicense?: string;
  weightsRedistributionVerified: boolean;
  inputWidth: number;
  inputHeight: number;
  classNames: string[];
}

export interface DetectorRuntimeMetadata {
  runtime: 'onnxruntime-web' | 'other';
  runtimeVersion?: string;
  backend: DetectorBackend;
  executionProviders: DetectorBackend[];
}

export interface DetectorInput {
  source: CanvasImageSource;
  sourceWidth: number;
  sourceHeight: number;
  timestampMs: number;
}

export interface DetectorTelemetry {
  preprocessMs: number;
  inferenceMs: number;
  postprocessMs: number;
  totalMs: number;
  detectionCountBeforeFiltering: number;
  detectionCount: number;
}

export interface DetectorOutput {
  detections: RawDetection[];
  timestampMs: number;
  telemetry: DetectorTelemetry;
}

export interface DetectorInitialization {
  model: DetectorModelMetadata;
  runtime: DetectorRuntimeMetadata;
}

/**
 * Detector contract consumed by Konta2r. Tracking, modal fusion and spatial
 * logic must not depend on a specific neural-network family or output tensor.
 */
export interface Detector {
  initialize(): Promise<DetectorInitialization>;
  detect(input: DetectorInput): Promise<DetectorOutput>;
  dispose(): Promise<void> | void;
  getInitialization(): DetectorInitialization | null;
}

export interface DetectorAccuracyObservation {
  className: string;
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
}

export interface DetectorClassMetrics {
  className: string;
  precision: number;
  recall: number;
  f1: number;
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
}
