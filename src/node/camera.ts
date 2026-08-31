import {
  NODE_PROFILE_SETTINGS,
  type NodePerformanceProfile,
} from './deviceProfile';

export interface CameraRuntimeState {
  active: boolean;
  width?: number;
  height?: number;
  frameRate?: number;
  facingMode?: string;
  deviceId?: string;
}

export function cameraConstraintsForProfile(
  profile: NodePerformanceProfile,
): MediaStreamConstraints {
  const settings = NODE_PROFILE_SETTINGS[profile];
  return {
    audio: false,
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: settings.captureWidth },
      height: { ideal: settings.captureHeight },
      frameRate: { ideal: settings.captureFps, max: settings.captureFps },
    },
  };
}

/**
 * Local-only camera controller. The MediaStream is attached directly to the
 * supplied video element and is never exposed through a network contract.
 */
export class NodeCameraController {
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private currentProfile: NodePerformanceProfile | null = null;
  private endedHandler: (() => void) | null = null;

  supported(): boolean {
    return Boolean(navigator.mediaDevices?.getUserMedia);
  }

  onUnexpectedEnd(handler: (() => void) | null): void {
    this.endedHandler = handler;
  }

  async start(
    video: HTMLVideoElement,
    profile: NodePerformanceProfile,
  ): Promise<CameraRuntimeState> {
    if (!this.supported()) throw new Error('Camera capture is not supported by this browser');
    await this.stop();

    const stream = await navigator.mediaDevices.getUserMedia(cameraConstraintsForProfile(profile));
    this.stream = stream;
    this.video = video;
    this.currentProfile = profile;
    const videoTrack = stream.getVideoTracks()[0];
    videoTrack?.addEventListener('ended', () => {
      if (this.stream !== stream) return;
      this.stream = null;
      this.currentProfile = null;
      if (this.video) this.video.srcObject = null;
      this.endedHandler?.();
    }, { once: true });

    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    await video.play();

    return this.state();
  }

  async reconfigure(profile: NodePerformanceProfile): Promise<CameraRuntimeState> {
    if (!this.video) throw new Error('Camera must be started before reconfiguration');
    if (this.currentProfile === profile) return this.state();
    return this.start(this.video, profile);
  }

  async stop(): Promise<void> {
    const stream = this.stream;
    this.stream = null;
    this.currentProfile = null;
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
    }
    if (this.video) this.video.srcObject = null;
  }

  state(): CameraRuntimeState {
    const track = this.stream?.getVideoTracks()[0];
    const settings = track?.getSettings();
    return {
      active: Boolean(track && track.readyState === 'live'),
      ...(settings?.width === undefined ? {} : { width: settings.width }),
      ...(settings?.height === undefined ? {} : { height: settings.height }),
      ...(settings?.frameRate === undefined ? {} : { frameRate: settings.frameRate }),
      ...(settings?.facingMode === undefined ? {} : { facingMode: settings.facingMode }),
      ...(settings?.deviceId === undefined ? {} : { deviceId: settings.deviceId }),
    };
  }
}
