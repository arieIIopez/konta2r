import type { RawDetection } from '../../core/types';
import type { DetectorInput } from '../types';
import type { OnnxValueMap } from './runtime';

export interface OnnxPreparedInput<TContext> {
  feeds: OnnxValueMap;
  context: TContext;
  dispose?: () => Promise<void> | void;
}

/**
 * Model-family-specific tensor preparation and output decoding live behind this
 * boundary. The generic ONNX adapter never assumes YOLO/DETR tensor names,
 * normalization, NMS behavior or output layout.
 */
export interface OnnxDetectorCodec<TContext = unknown> {
  prepare(input: DetectorInput): Promise<OnnxPreparedInput<TContext>>;
  decode(
    outputs: OnnxValueMap,
    context: TContext,
    input: DetectorInput,
  ): Promise<RawDetection[]> | RawDetection[];
}
