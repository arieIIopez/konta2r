interface WakeLockSentinelLike extends EventTarget {
  released: boolean;
  release(): Promise<void>;
}

interface WakeLockLike {
  request(type?: 'screen'): Promise<WakeLockSentinelLike>;
}

interface NavigatorWithWakeLock extends Navigator {
  wakeLock?: WakeLockLike;
}

export interface WakeLockState {
  supported: boolean;
  desired: boolean;
  active: boolean;
  lastError?: string;
}

/**
 * Progressive enhancement wrapper. The node continues operating when wake lock
 * is unsupported or revoked; UI/telemetry can surface that limitation.
 */
export class ScreenWakeLockController {
  private sentinel: WakeLockSentinelLike | null = null;
  private desired = false;
  private lastError: string | undefined;
  private readonly visibilityHandler = (): void => {
    if (this.desired && document.visibilityState === 'visible' && !this.sentinel) {
      void this.acquire();
    }
  };

  constructor() {
    document.addEventListener('visibilitychange', this.visibilityHandler);
  }

  supported(): boolean {
    return Boolean((navigator as NavigatorWithWakeLock).wakeLock?.request);
  }

  async enable(): Promise<WakeLockState> {
    this.desired = true;
    await this.acquire();
    return this.state();
  }

  async disable(): Promise<WakeLockState> {
    this.desired = false;
    if (this.sentinel) {
      try {
        await this.sentinel.release();
      } catch {
        // Already released by the user agent.
      }
    }
    this.sentinel = null;
    return this.state();
  }

  state(): WakeLockState {
    return {
      supported: this.supported(),
      desired: this.desired,
      active: Boolean(this.sentinel && !this.sentinel.released),
      ...(this.lastError === undefined ? {} : { lastError: this.lastError }),
    };
  }

  destroy(): void {
    document.removeEventListener('visibilitychange', this.visibilityHandler);
    void this.disable();
  }

  private async acquire(): Promise<void> {
    this.lastError = undefined;
    if (!this.desired || document.visibilityState !== 'visible') return;
    const wakeLock = (navigator as NavigatorWithWakeLock).wakeLock;
    if (!wakeLock?.request) {
      this.lastError = 'unsupported';
      return;
    }

    try {
      const sentinel = await wakeLock.request('screen');
      this.sentinel = sentinel;
      sentinel.addEventListener('release', () => {
        if (this.sentinel === sentinel) this.sentinel = null;
      }, { once: true });
    } catch (error) {
      this.sentinel = null;
      this.lastError = error instanceof Error ? error.message : 'wake_lock_refused';
    }
  }
}
