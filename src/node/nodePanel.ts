import type { NodeCommunityRuntime } from '../community/nodeCommunityController';
import { NanoDetPilotPipeline } from '../detection/nanodetPilotPipeline';
import type { EdgeMobilityPipelineFrame } from '../pipeline/edgeMobilityPipeline';
import type { PwaRuntimeState } from '../pwa/register';
import { NODE_PROFILE_SETTINGS, type NodePerformanceProfile } from './deviceProfile';
import type { InferenceLoopState } from './inferenceLoop';
import { NodeCommunityPanel } from './nodeCommunityPanel';
import { NodeRuntimeController, type NodeRuntimeSnapshot } from './runtimeController';
import { RuntimeInferenceBridge } from './runtimeInferenceBridge';

export interface NodePanelOptions {
  /** Explicit field-pilot opt-in. It is never enabled by default. */
  experimentalDetector?: 'nanodet';
}

interface PilotFrameStats {
  detections: number;
  fusedEntities: number;
  confirmedTracks: number;
}

function formatBytes(value: number | undefined): string {
  if (value === undefined) return '—';
  const gib = value / (1024 ** 3);
  return gib >= 0.1 ? `${gib.toFixed(1)} GiB` : `${(value / (1024 ** 2)).toFixed(0)} MiB`;
}

function formatDuration(valueMs: number): string {
  if (valueMs < 60_000) return `${Math.round(valueMs / 1000)} s`;
  if (valueMs < 3_600_000) return `${(valueMs / 60_000).toFixed(1)} min`;
  return `${(valueMs / 3_600_000).toFixed(1)} h`;
}

function setText(root: HTMLElement, selector: string, value: string): void {
  const element = root.querySelector<HTMLElement>(selector);
  if (element) element.textContent = value;
}

export class NodePanel {
  private readonly runtime = new NodeRuntimeController();
  private readonly pwa: PwaRuntimeState;
  private readonly community: NodeCommunityRuntime;
  private readonly communityPanel: NodeCommunityPanel;
  private readonly pilotPipeline: NanoDetPilotPipeline | null;
  private readonly inferenceBridge: RuntimeInferenceBridge<EdgeMobilityPipelineFrame> | null;
  private root: HTMLElement | null = null;
  private unsubscribe: (() => void) | null = null;
  private pilotLoopState: InferenceLoopState = 'idle';
  private pilotFrameStats: PilotFrameStats | null = null;
  private pilotError: string | undefined;

  constructor(
    pwa: PwaRuntimeState,
    community: NodeCommunityRuntime,
    options: NodePanelOptions = {},
  ) {
    this.pwa = pwa;
    this.community = community;
    this.communityPanel = new NodeCommunityPanel(community);
    if (options.experimentalDetector === 'nanodet') {
      this.pilotPipeline = new NanoDetPilotPipeline({
        maxDetections: () => NODE_PROFILE_SETTINGS[this.runtime.snapshot().profile].maxDetections,
      });
      this.inferenceBridge = new RuntimeInferenceBridge(this.runtime, this.pilotPipeline, {
        onFrame: (frame) => {
          this.pilotFrameStats = {
            detections: frame.detector.detections.length,
            fusedEntities: frame.fusion.entities.length,
            confirmedTracks: frame.tracking.confirmedTracks.length,
          };
          this.renderPilot();
        },
        onStateChange: (state) => {
          this.pilotLoopState = state;
          if (state !== 'error') this.pilotError = undefined;
          this.renderPilot();
        },
        onError: (error) => {
          this.pilotError = error.message;
          this.renderPilot();
        },
      });
    } else {
      this.pilotPipeline = null;
      this.inferenceBridge = null;
    }
  }

  mount(root: HTMLElement): void {
    this.root = root;
    root.innerHTML = `
      <section class="node-runtime-shell">
        <div class="node-runtime-head">
          <div>
            <span class="eyebrow">Konta2r Node</span>
            <h2>Operación local</h2>
            <p>La cámara permanece en este dispositivo. El modo Community usa agregados.</p>
          </div>
          <span class="status-pill" data-node-status>○ nodo detenido</span>
        </div>
        <div class="node-runtime-grid">
          <div class="node-camera-wrap">
            <video id="node-camera" playsinline muted></video>
            <div class="node-camera-placeholder" data-camera-placeholder>
              <strong data-camera-title>Cámara local detenida</strong>
              <span data-camera-help>Inicia el nodo para solicitar permiso de cámara.</span>
            </div>
          </div>
          <div class="node-runtime-status">
            <div class="runtime-stat"><span>Perfil</span><strong data-profile>—</strong><small data-profile-detail>—</small></div>
            <div class="runtime-stat"><span>Cámara</span><strong data-camera>—</strong><small data-camera-detail>—</small></div>
            <div class="runtime-stat"><span>Detector</span><strong data-detector>—</strong><small data-detector-detail>—</small></div>
            <div class="runtime-stat"><span>Semántica</span><strong data-semantic>—</strong><small data-semantic-detail>—</small></div>
            <div class="runtime-stat"><span>Carga</span><strong data-load>—</strong><small data-load-detail>—</small></div>
            <div class="runtime-stat"><span>Continuidad</span><strong data-continuity>—</strong><small data-continuity-detail>—</small></div>
            <div class="runtime-stat"><span>Wake lock</span><strong data-wake>—</strong><small data-wake-detail>—</small></div>
            <div class="runtime-stat"><span>Storage</span><strong data-storage>—</strong><small data-storage-detail>—</small></div>
            <div class="runtime-stat"><span>Red</span><strong data-network>—</strong><small>la cola local puede seguir acumulando agregados</small></div>
            <div class="runtime-stat"><span>PWA</span><strong data-pwa>—</strong><small data-pwa-detail>—</small></div>
          </div>
        </div>
        <div class="node-runtime-controls">
          <button class="action primary" data-start>Iniciar nodo</button>
          <button class="action" data-stop>Detener</button>
          <label class="profile-control">Perfil
            <select data-profile-select>
              <option value="eco">eco</option>
              <option value="balanced">balanced</option>
              <option value="performance">performance</option>
            </select>
          </label>
          <button class="action" data-persist>Proteger almacenamiento</button>
        </div>
        <div class="community-slot" data-community-mount></div>
        <p class="runtime-note" data-hints></p>
        <p class="runtime-error hidden" data-error></p>
      </section>`;

    const video = root.querySelector<HTMLVideoElement>('#node-camera');
    if (!video) throw new Error('Missing node camera surface');
    this.runtime.attachVideo(video);
    this.inferenceBridge?.attachVideo(video);

    const communityMount = root.querySelector<HTMLElement>('[data-community-mount]');
    if (!communityMount) throw new Error('Missing Community node surface');
    this.communityPanel.mount(communityMount);

    root.querySelector<HTMLButtonElement>('[data-start]')?.addEventListener('click', () => void this.runtime.start());
    root.querySelector<HTMLButtonElement>('[data-stop]')?.addEventListener('click', () => void this.runtime.stop());
    root.querySelector<HTMLButtonElement>('[data-persist]')?.addEventListener('click', () => void this.runtime.inspectStorage(true));
    root.querySelector<HTMLSelectElement>('[data-profile-select]')?.addEventListener('change', (event) => {
      const value = (event.currentTarget as HTMLSelectElement).value as NodePerformanceProfile;
      void this.runtime.setProfile(value);
    });

    this.unsubscribe?.();
    this.unsubscribe = this.runtime.subscribe((snapshot) => this.update(snapshot));
    this.renderPilot();
    void this.runtime.inspectStorage(false);
  }

  destroy(): void {
    this.unsubscribe?.();
    this.inferenceBridge?.detachVideo();
    if (this.inferenceBridge) void this.inferenceBridge.dispose();
    this.communityPanel.destroy();
    this.community.destroy();
    this.runtime.destroy();
    this.root = null;
  }

  private update(snapshot: NodeRuntimeSnapshot): void {
    const root = this.root;
    if (!root) return;
    const profileSettings = NODE_PROFILE_SETTINGS[snapshot.profile];
    const status = root.querySelector<HTMLElement>('[data-node-status]');
    if (status) {
      status.textContent = snapshot.running ? '● nodo activo' : '○ nodo detenido';
      status.classList.toggle('runtime-on', snapshot.running);
    }

    setText(root, '[data-profile]', snapshot.profile);
    setText(root, '[data-profile-detail]', `${profileSettings.captureWidth}×${profileSettings.captureHeight} · inferencia objetivo ${profileSettings.inferenceFps} Hz`);
    setText(root, '[data-camera]', snapshot.camera.active ? 'activa' : 'detenida');
    setText(root, '[data-camera-detail]', snapshot.camera.active
      ? `${snapshot.camera.width ?? '—'}×${snapshot.camera.height ?? '—'}${snapshot.camera.frameRate ? ` · ${snapshot.camera.frameRate.toFixed(0)} fps` : ''}`
      : 'sin captura');

    if (snapshot.health.sampleCount === 0) {
      setText(root, '[data-load]', 'sin muestras');
      setText(root, '[data-load-detail]', this.pilotPipeline
        ? 'se activará con el piloto ONNX al iniciar el nodo'
        : 'se activará cuando exista un loop de inferencia ONNX');
    } else {
      setText(root, '[data-load]', snapshot.health.loadPressure);
      setText(root, '[data-load-detail]', `${snapshot.health.observedFps.toFixed(1)} Hz · p50 ${snapshot.health.inferenceFpsP50.toFixed(1)} Hz · p95 ${snapshot.health.processingLatencyP95Ms.toFixed(0)} ms · drops ${(snapshot.health.droppedFrameRatio * 100).toFixed(0)}%`);
    }

    if (snapshot.continuity.elapsedMs === 0) {
      setText(root, '[data-continuity]', 'sin sesión');
      setText(root, '[data-continuity-detail]', 'el uptime se calcula desde el inicio del nodo');
    } else {
      setText(root, '[data-continuity]', `${(snapshot.continuity.uptimeRatio * 100).toFixed(1)}%`);
      setText(root, '[data-continuity-detail]', `${formatDuration(snapshot.continuity.activeMs)} activos · ${snapshot.continuity.gapCount} gaps · gap máx. ${formatDuration(snapshot.continuity.longestGapMs)}`);
    }

    setText(root, '[data-wake]', snapshot.wakeLock.active ? 'activo' : snapshot.wakeLock.supported ? 'inactivo' : 'no disponible');
    setText(root, '[data-wake-detail]', snapshot.wakeLock.supported ? 'se solicita al iniciar' : 'el navegador no expone la API');
    setText(root, '[data-storage]', snapshot.storage?.persistent ? 'persistente' : 'evictable');
    setText(root, '[data-storage-detail]', `${formatBytes(snapshot.storage?.usageBytes)} / ${formatBytes(snapshot.storage?.quotaBytes)}`);
    setText(root, '[data-network]', snapshot.online ? 'online' : 'offline');
    setText(root, '[data-pwa]', this.pwa.standalone ? 'instalada' : this.pwa.registered ? 'lista' : 'sin service worker');
    setText(root, '[data-pwa-detail]', this.pwa.serviceWorkerSupported ? 'shell offline habilitable' : 'service worker no soportado');

    const placeholder = root.querySelector<HTMLElement>('[data-camera-placeholder]');
    placeholder?.classList.toggle('hidden', snapshot.camera.active);
    setText(root, '[data-camera-title]', snapshot.busy ? 'Preparando nodo…' : 'Cámara local detenida');
    setText(root, '[data-camera-help]', snapshot.secureContext
      ? 'La imagen no sale del dispositivo.'
      : 'Se requiere HTTPS o localhost para acceder a cámara y PWA.');

    const start = root.querySelector<HTMLButtonElement>('[data-start]');
    if (start) start.disabled = snapshot.running || snapshot.busy || !snapshot.secureContext;
    const stop = root.querySelector<HTMLButtonElement>('[data-stop]');
    if (stop) stop.disabled = !snapshot.running || snapshot.busy;
    const profile = root.querySelector<HTMLSelectElement>('[data-profile-select]');
    if (profile) {
      profile.value = snapshot.profile;
      profile.disabled = snapshot.busy;
    }
    const persist = root.querySelector<HTMLButtonElement>('[data-persist]');
    if (persist) persist.disabled = snapshot.storage?.persistent === true;

    const memory = snapshot.hints.deviceMemoryGiB === undefined ? '' : ` · ~${snapshot.hints.deviceMemoryGiB} GiB RAM reportada`;
    setText(root, '[data-hints]', `Arranque automático: ${snapshot.hints.hardwareConcurrency} hilos lógicos · ${snapshot.hints.webgpu ? 'WebGPU disponible' : 'sin WebGPU'}${memory}. El desempeño medido tendrá prioridad sobre estos hints.`);

    this.renderPilot();
    const error = root.querySelector<HTMLElement>('[data-error]');
    if (error) {
      const message = snapshot.error ?? this.pilotError;
      error.textContent = message ?? '';
      error.classList.toggle('hidden', message === undefined);
    }
  }

  private renderPilot(): void {
    const root = this.root;
    if (!root) return;
    if (!this.pilotPipeline) {
      setText(root, '[data-detector]', 'desactivado');
      setText(root, '[data-detector-detail]', 'build estándar · sin detector experimental');
      setText(root, '[data-semantic]', 'sin loop');
      setText(root, '[data-semantic-detail]', 'la cámara puede operar sin inferencia');
      return;
    }

    const pilot = this.pilotPipeline.snapshot();
    if (pilot.state === 'idle') {
      setText(root, '[data-detector]', 'NanoDet piloto');
      setText(root, '[data-detector-detail]', 'externo · SHA verificado al iniciar · no seleccionado para producción');
    } else if (pilot.state === 'loading') {
      setText(root, '[data-detector]', 'cargando piloto…');
      setText(root, '[data-detector-detail]', 'descarga/cache local + verificación SHA-256');
    } else if (pilot.state === 'ready') {
      setText(root, '[data-detector]', `NanoDet · ${pilot.backend ?? '—'}`);
      setText(root, '[data-detector-detail]', `${pilot.artifactSource === 'cache' ? 'cache verificado' : 'descarga verificada'}${pilot.cachePersisted ? ' · persistido' : ''} · ${pilot.modelSha256?.slice(0, 12) ?? '—'}…`);
    } else if (pilot.state === 'error') {
      setText(root, '[data-detector]', 'error de piloto');
      setText(root, '[data-detector-detail]', pilot.error ?? 'fallo de inicialización');
    } else {
      setText(root, '[data-detector]', pilot.state);
      setText(root, '[data-detector-detail]', 'runtime piloto');
    }

    const frame = this.pilotFrameStats;
    setText(root, '[data-semantic]', this.pilotLoopState);
    setText(root, '[data-semantic-detail]', frame
      ? `${frame.detections} detecciones · ${frame.fusedEntities} entidades · ${frame.confirmedTracks} tracks confirmados`
      : 'sin frame procesado aún');
  }
}
