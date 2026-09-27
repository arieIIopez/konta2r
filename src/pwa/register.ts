export interface PwaRuntimeState {
  serviceWorkerSupported: boolean;
  registered: boolean;
  standalone: boolean;
  error?: string;
}

function isStandaloneDisplay(): boolean {
  const mediaStandalone = window.matchMedia?.('(display-mode: standalone)').matches ?? false;
  const iosStandalone = Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  return mediaStandalone || iosStandalone;
}

export async function registerKonta2rServiceWorker(): Promise<PwaRuntimeState> {
  const supported = 'serviceWorker' in navigator;
  if (!supported) {
    return {
      serviceWorkerSupported: false,
      registered: false,
      standalone: isStandaloneDisplay(),
    };
  }

  try {
    await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    return {
      serviceWorkerSupported: true,
      registered: true,
      standalone: isStandaloneDisplay(),
    };
  } catch (error) {
    return {
      serviceWorkerSupported: true,
      registered: false,
      standalone: isStandaloneDisplay(),
      error: error instanceof Error ? error.message : 'service_worker_registration_failed',
    };
  }
}
