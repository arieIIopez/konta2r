import type { DetectorBackend } from '../detection/types';
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
}

export type NodePilotPipelineFactory = (
  maxDetections: () => number,
) => NodePilotPipeline;
