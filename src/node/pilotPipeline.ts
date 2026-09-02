import type { DetectorBackend, DetectorInitialization } from '../detection/types';
import type { NormalizedDirectedLine } from '../geometry/normalized';
import type { EdgeMobilityPipelineFrame } from '../pipeline/edgeMobilityPipeline';
import type { InferenceFrameProcessor } from './inferenceLoop';

export interface NodePilotPipelineSnapshot {
  state: 'idle' | 'loading' | 'ready' | 'error' | 'disposed';
  displayName: string;
  candidateId?: string;
  modelSha256?: string;
  artifactSource?: 'cache' | 'network';
  cachePersisted?: boolean;
  backend?: DetectorBackend;
  error?: string;
}

export interface NodePilotPipeline extends InferenceFrameProcessor<EdgeMobilityPipelineFrame> {
  snapshot(): NodePilotPipelineSnapshot;
  /** Redacted model/runtime metadata needed by evidence and Community envelopes. */
  getInitialization(): DetectorInitialization | null;
  /** Replaces local counting geometry; an empty list explicitly disables counting. */
  setCountingLines(lines: readonly NormalizedDirectedLine[]): void;
  /** Starts a clean trajectory/event epoch without reloading the detector model. */
  resetTrackingAndEvents(): void;
}

export type NodePilotPipelineFactory = (
  maxDetections: () => number,
) => NodePilotPipeline;
