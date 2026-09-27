import type { EdgeMobilityPipelineFrame } from '../pipeline/edgeMobilityPipeline';
import type { CommunityFlowBucketPublisher } from '../community/flowBucketPublisher';

export interface RuntimeCommunityBridgeOptions {
  onError?: (error: Error) => void;
}

/**
 * Thin operational adapter for RuntimeInferenceBridge.onFrame. It deliberately
 * receives semantic pipeline frames, never raw video frames. Connectivity
 * recovery triggers publication/outbox retry without involving human auth.
 */
export class RuntimeCommunityBridge {
  private readonly publisher: CommunityFlowBucketPublisher;
  private readonly onError: ((error: Error) => void) | undefined;
  private disposed = false;

  constructor(
    publisher: CommunityFlowBucketPublisher,
    options: RuntimeCommunityBridgeOptions = {},
  ) {
    this.publisher = publisher;
    this.onError = options.onError;
    window.addEventListener('online', this.onlineHandler);
  }

  readonly onFrame = (frame: EdgeMobilityPipelineFrame): void => {
    if (this.disposed) return;
    void this.publisher.observeFrame(frame).catch((error: unknown) => this.report(error));
  };

  async flushNow(): Promise<void> {
    if (this.disposed) return;
    try {
      await this.publisher.publishClosed();
    } catch (error) {
      this.report(error);
    }
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener('online', this.onlineHandler);
  }

  private readonly onlineHandler = (): void => {
    if (this.disposed) return;
    void this.publisher.connectivityRestored().catch((error: unknown) => this.report(error));
  };

  private report(error: unknown): void {
    this.onError?.(error instanceof Error ? error : new Error(String(error)));
  }
}
