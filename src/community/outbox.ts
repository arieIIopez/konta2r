import {
  assertCommunityUploadSafe,
  type CommunityUploadEnvelope,
} from './protocol';

export type OutboxStatus = 'pending' | 'dead_letter';

export interface CommunityOutboxItem {
  id: string;
  nodeId: string;
  sequence: number;
  payload: CommunityUploadEnvelope;
  status: OutboxStatus;
  createdAtMs: number;
  updatedAtMs: number;
  attempts: number;
  nextAttemptAtMs: number;
  lastError?: string;
}

export interface CommunityOutboxStore {
  put(item: CommunityOutboxItem): Promise<void>;
  get(id: string): Promise<CommunityOutboxItem | undefined>;
  getDue(nowMs: number, limit: number, nodeId?: string): Promise<CommunityOutboxItem[]>;
  delete(id: string): Promise<void>;
  count(status?: OutboxStatus): Promise<number>;
}

export interface DeliveryResult {
  ok: boolean;
  statusCode?: number;
  retryable: boolean;
  error?: string;
}

export type CommunitySender = (
  envelope: CommunityUploadEnvelope,
  idempotencyKey: string,
) => Promise<DeliveryResult>;

export interface OutboxFlushOptions {
  nowMs?: number;
  limit?: number;
  maxAttempts?: number;
  randomUnit?: () => number;
  /** Prevents a credential for one node from ever flushing another node's queue. */
  nodeId?: string;
}

export interface OutboxFlushResult {
  attempted: number;
  delivered: number;
  retryScheduled: number;
  deadLettered: number;
}

export function communityIdempotencyKey(nodeId: string, sequence: number): string {
  return `${nodeId}:${sequence}`;
}

export function computeRetryDelayMs(attempt: number, jitterUnit = 0.5): number {
  const safeAttempt = Math.max(1, Math.floor(attempt));
  const base = 2_000;
  const cap = 15 * 60_000;
  const exponential = Math.min(cap, base * 2 ** Math.min(12, safeAttempt - 1));
  const jitter = 0.75 + 0.5 * Math.min(1, Math.max(0, jitterUnit));
  return Math.round(exponential * jitter);
}

export function createOutboxItem(
  envelope: CommunityUploadEnvelope,
  nowMs = Date.now(),
): CommunityOutboxItem {
  assertCommunityUploadSafe(envelope);
  return {
    id: communityIdempotencyKey(envelope.nodeId, envelope.sequence),
    nodeId: envelope.nodeId,
    sequence: envelope.sequence,
    payload: envelope,
    status: 'pending',
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
    attempts: 0,
    nextAttemptAtMs: nowMs,
  };
}

/**
 * Insert is idempotent at the store key level. Re-enqueuing the same node
 * sequence replaces the same item rather than creating duplicate uploads.
 */
export async function enqueueCommunityUpload(
  store: CommunityOutboxStore,
  envelope: CommunityUploadEnvelope,
  nowMs = Date.now(),
): Promise<CommunityOutboxItem> {
  const item = createOutboxItem(envelope, nowMs);
  const existing = await store.get(item.id);
  if (existing) return existing;
  await store.put(item);
  return item;
}

export async function flushCommunityOutbox(
  store: CommunityOutboxStore,
  sender: CommunitySender,
  options: OutboxFlushOptions = {},
): Promise<OutboxFlushResult> {
  const nowMs = options.nowMs ?? Date.now();
  const limit = Math.max(1, Math.min(100, Math.floor(options.limit ?? 20)));
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? 20));
  const randomUnit = options.randomUnit ?? Math.random;
  const candidates = await store.getDue(nowMs, limit, options.nodeId);
  // Defensive filtering is intentional even when the store supports nodeId.
  // A legacy/custom store that ignores the optional argument still cannot leak
  // a batch into a sender authenticated as another sensor.
  const due = candidates
    .filter((item) => options.nodeId === undefined || item.nodeId === options.nodeId)
    .slice(0, limit);

  const result: OutboxFlushResult = {
    attempted: 0,
    delivered: 0,
    retryScheduled: 0,
    deadLettered: 0,
  };

  // Sequential delivery is intentional on old phones: it avoids bursty CPU,
  // radio and memory use and preserves simple per-node sequence semantics.
  for (const item of due) {
    if (item.status !== 'pending') continue;
    result.attempted += 1;

    let delivery: DeliveryResult;
    try {
      delivery = await sender(item.payload, item.id);
    } catch (error) {
      delivery = {
        ok: false,
        retryable: true,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    if (delivery.ok) {
      await store.delete(item.id);
      result.delivered += 1;
      continue;
    }

    const attempts = item.attempts + 1;
    const permanent = !delivery.retryable || attempts >= maxAttempts;
    if (permanent) {
      await store.put({
        ...item,
        status: 'dead_letter',
        attempts,
        updatedAtMs: nowMs,
        lastError: delivery.error ?? `HTTP ${delivery.statusCode ?? 'unknown'}`,
      });
      result.deadLettered += 1;
      continue;
    }

    const delay = computeRetryDelayMs(attempts, randomUnit());
    await store.put({
      ...item,
      attempts,
      updatedAtMs: nowMs,
      nextAttemptAtMs: nowMs + delay,
      lastError: delivery.error ?? `HTTP ${delivery.statusCode ?? 'unknown'}`,
    });
    result.retryScheduled += 1;
  }

  return result;
}
