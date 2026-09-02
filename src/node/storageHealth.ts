export interface NodeStorageHealth {
  supported: boolean;
  persistent: boolean;
  persistenceRequested: boolean;
  usageBytes?: number;
  quotaBytes?: number;
  usageRatio?: number;
  error?: string;
}

function ratio(usage: number | undefined, quota: number | undefined): number | undefined {
  if (usage === undefined || quota === undefined || !(quota > 0)) return undefined;
  return Math.min(1, Math.max(0, usage / quota));
}

export async function inspectNodeStorage(
  requestPersistence = false,
): Promise<NodeStorageHealth> {
  const manager = navigator.storage;
  if (!manager) {
    return {
      supported: false,
      persistent: false,
      persistenceRequested: false,
    };
  }

  try {
    const wasPersistent = typeof manager.persisted === 'function'
      ? await manager.persisted()
      : false;
    let persistent = wasPersistent;
    let persistenceRequested = false;

    if (!persistent && requestPersistence && typeof manager.persist === 'function') {
      persistenceRequested = true;
      persistent = await manager.persist();
    }

    const estimate = typeof manager.estimate === 'function'
      ? await manager.estimate()
      : {};
    const usageBytes = estimate.usage;
    const quotaBytes = estimate.quota;
    const usageRatio = ratio(usageBytes, quotaBytes);

    return {
      supported: true,
      persistent,
      persistenceRequested,
      ...(usageBytes === undefined ? {} : { usageBytes }),
      ...(quotaBytes === undefined ? {} : { quotaBytes }),
      ...(usageRatio === undefined ? {} : { usageRatio }),
    };
  } catch (error) {
    return {
      supported: true,
      persistent: false,
      persistenceRequested: requestPersistence,
      error: error instanceof Error ? error.message : 'storage_diagnostic_failed',
    };
  }
}
