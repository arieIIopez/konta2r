import type { NodeCommunityRuntime } from '../community/nodeCommunityController';
import type { EdgeMobilityPipelineFrame } from '../pipeline/edgeMobilityPipeline';
import type { PwaRuntimeState } from '../pwa/register';
import { KONTA2R_VERSION } from '../version';
import type { CountingGeometryConfiguration } from './countingGeometry';
import { NODE_PROFILE_SETTINGS, type NodePerformanceProfile } from './deviceProfile';
import {
  FieldPilotEvidenceRecorder,
  type FieldPilotSemanticSnapshot,
} from './fieldPilotEvidence';
import { IndexedDbFieldPilotEvidenceStore } from './indexedDbFieldPilotEvidence';
import type { InferenceLoopState } from './inferenceLoop';
import { NodeCommunityPanel } from './nodeCommunityPanel';
import type { NodePilotPipeline, NodePilotPipelineFactory } from './pilotPipeline';
import { NodeRuntimeController, type NodeRuntimeSnapshot } from './runtimeController';
import { RuntimeInferenceBridge } from './runtimeInferenceBridge';

export interface NodePanelOptions {
  /** Optional pilot factory supplied by a dynamically imported experimental chunk. */
  pilotPipelineFactory?: NodePilotPipelineFactory;
}

interface PilotFrameStats extends FieldPilotSemanticSnapshot {}

interface LocalCrossingCounts {
  aToB: number;
  bToA: number;
}

function emptyCrossingCounts(): LocalCrossingCounts {
  return { aToB: 0, bToA: 0 };
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

function downloadText(filename: string, text: string, type: string): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export class NodePanel {
  private readonly runtime = new NodeRuntimeController();
  private readonly pwa: PwaRuntimeState;
  private readonly community: NodeCommunityRuntime;
  private readonly communityPanel: NodeCommunityPanel;
  private readonly pilotPipeline: NodePilotPipeline | null;
  private readonly inferenceBridge: RuntimeInferenceBridge<EdgeMobilityPipelineFrame> | null;
  private readonly fieldPilotEvidence: FieldPilotEvidenceRecorder | null;
  private root: HTMLElement | null = null;
  private unsubscribe: (() => void) | null = null;
  private pilotLoopState: InferenceLoopState = 'idle';
  private pilotFrameStats: PilotFrameStats | null = null;
  private pilotError: string | undefined;
  private evidenceStatus = 'sin sesión';
  private evidenceError: string | undefined;
  private countingGeometry: CountingGeometryConfiguration | undefined;
  private countingGeometryKey = 'none';
  private localCrossings = emptyCrossingCounts();

  constructor(
    pwa: PwaRuntimeState,
    community: NodeCommunityRuntime,
    options: NodePanelOptions = {},
  ) {
    this.pwa = pwa;
    this.community = community;
    this.communityPanel = new NodeCommunityPanel(community);
    this.pilotPipeline = options.pilotPipelineFactory?.(
      () => NODE_PROFILE_SETTINGS[this.runtime.snapshot().profile].maxDetections,
    ) ?? null;
    this.fieldPilotEvidence = this.pilotPipeline
      ? new FieldPilotEvidenceRecorder(new IndexedDbFieldPilotEvidenceStore(), {
          softwareVersion: KONTA2R_VERSION,
        })
      : null;
    this.inferenceBridge = this.pilotPipeline
      ? new RuntimeInferenceBridge(this.runtime, this.pilotPipeline, {
          onFrame: (frame) => {
            this.pilotFrameStats = {
              detections: frame.detector.detections.length,
              fusedEntities: frame.fusion.entities.length,
              confirmedTracks: frame.tracking.confirmedTracks.length,
            };
            for (const crossing of frame.crossings) {
              if (crossing.direction === 'LEFT_TO_RIGHT') this.localCrossings.aToB += 1;
              else this.localCrossings.bToA += 1;
            }
            void this.recordPilotEvidence();
            this.renderPilot();
          },
          onStateChange: (state) => {
            this.pilotLoopState = state;
            if (state !== 'error') this.pilotError = undefined;
            void this.recordPilotEvidence();
            this.renderPilot();
          },
          onError: (error) => {
            this.pilotError = error.message;
            void this.recordPilotEvidence();
            this.renderPilot();
          },
        })
      : null;
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
            <div class="runtime-stat"><span>Cruces locales</span><strong data-crossings>0</strong><small data-crossings-detail>sin geometría operacional</small></div>
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
          <button class="action" data-pilot-export>Exportar evidencia piloto</button>
        </div>
        <p class="runtime-note" data-pilot-evidence-status></p>
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

    root.querySelector<HTMLButtonElement>('[data-start]')?.addEventListener('click', () => void this.startNode());
    root.querySelector<HTMLButtonElement>('[data-stop]')?.addEventListener('click', () => void this.runtime.stop());
    root.querySelector<HTMLButtonElement>('[data-persist]')?.addEventListener('click', () => void this.runtime.inspectStorage(true));
    root.querySelector<HTMLButtonElement>('[data-pilot-export]')?.addEventListener('click', () => void this.exportPilotEvidence());
    root.querySelector<HTMLSelectElement>('[data-profile-select]')?.addEventListener('change', (event) => {
      const value = (event.currentTarget as HTMLSelectElement).value as NodePerformanceProfile;
      void this.changeProfile(value);
    });

    if (this.fieldPilotEvidence) {
      this.evidenceStatus = 'preparando registro local…';
      void this.fieldPilotEvidence.initialize()
        .then(() => {
          this.evidenceStatus = 'registro piloto listo · muestreo local durable cada 30 s y ante cambios de estado';
          this.evidenceError = undefined;
          this.renderEvidenceStatus();
        })
        .catch((error: unknown) => {
          this.evidenceError = error instanceof Error ? error.message : String(error);
          this.renderEvidenceStatus();
        });
    }

    this.unsubscribe?.();
    this.unsubscribe = this.runtime.subscribe((snapshot) => this.update(snapshot));
    this.renderPilot();
    void this.runtime.inspectStorage(false);
  }

  /**
   * Applies one saved operational geometry epoch. Undefined disables counting.
   * Every state transition starts fresh local counters because tracking/event
   * history is reset at the pipeline boundary as well.
   */
  setCountingGeometry(configuration: CountingGeometryConfiguration | undefined): void {
    const nextKey = configuration
      ? `${configuration.configurationId}:${configuration.revision}`
      : 'none';
    if (nextKey === this.countingGeometryKey) return;

    this.countingGeometryKey = nextKey;
    this.countingGeometry = configuration === undefined ? undefined : structuredClone(configuration);
    this.localCrossings = emptyCrossingCounts();
    this.pilotPipeline?.setCountingLines(configuration ? [configuration.line] : []);
    this.renderCrossings();
  }

  destroy(): void {
    this.unsubscribe?.();
    void this.fieldPilotEvidence?.interruptActive();
    this.inferenceBridge?.detachVideo();
    if (this.inferenceBridge) void this.inferenceBridge.dispose();
    this.communityPanel.destroy();
    this.community.destroy();
    this.runtime.destroy();
    this.root = null;
  }

  private async startNode(): Promise<void> {
    this.localCrossings = emptyCrossingCounts();
    this.pilotPipeline?.resetTrackingAndEvents();
    this.renderCrossings();
    await this.runtime.start();
  }

  private async changeProfile(profile: NodePerformanceProfile): Promise<void> {
    this.localCrossings = emptyCrossingCounts();
    this.pilotPipeline?.resetTrackingAndEvents();
    this.renderCrossings();
    await this.runtime.setProfile(profile);
  }

  private update(snapshot: NodeRuntimeSnapshot): void {
    void this.recordPilotEvidence(snapshot);
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
    const exportButton = root.querySelector<HTMLButtonElement>('[data-pilot-export]');
    if (exportButton) exportButton.disabled = this.fieldPilotEvidence === null;

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
      this.renderCrossings();
      this.renderEvidenceStatus();
      return;
    }

    const pilot = this.pilotPipeline.snapshot();
    if (pilot.state === 'idle') {
      setText(root, '[data-detector]', pilot.displayName);
      setText(root, '[data-detector-detail]', 'externo · SHA verificado al iniciar · no seleccionado para producción');
    } else if (pilot.state === 'loading') {
      setText(root, '[data-detector]', `cargando ${pilot.displayName}…`);
      setText(root, '[data-detector-detail]', 'descarga/cache local + verificación SHA-256');
    } else if (pilot.state === 'ready') {
      setText(root, '[data-detector]', `${pilot.displayName} · ${pilot.backend ?? '—'}`);
      setText(root, '[data-detector-detail]', `${pilot.artifactSource === 'cache' ? 'cache verificado' : 'descarga verificada'}${pilot.cachePersisted ? ' · persistido' : ''} · ${pilot.modelSha256?.slice(0, 12) ?? '—'}…`);
    } else if (pilot.state === 'error') {
      setText(root, '[data-detector]', 'error de piloto');
      setText(root, '[data-detector-detail]', pilot.error ?? 'fallo de inicialización');
    } else {
      setText(root, '[data-detector]', `${pilot.displayName} · ${pilot.state}`);
      setText(root, '[data-detector-detail]', 'runtime piloto');
    }

    const frame = this.pilotFrameStats;
    setText(root, '[data-semantic]', this.pilotLoopState);
    setText(root, '[data-semantic-detail]', frame
      ? `${frame.detections} detecciones · ${frame.fusedEntities} entidades · ${frame.confirmedTracks} tracks confirmados`
      : 'sin frame procesado aún');
    this.renderCrossings();
    this.renderEvidenceStatus();
  }

  private renderCrossings(): void {
    const root = this.root;
    if (!root) return;
    const total = this.localCrossings.aToB + this.localCrossings.bToA;
    setText(root, '[data-crossings]', String(total));
    if (!this.pilotPipeline) {
      setText(root, '[data-crossings-detail]', 'requiere detector experimental activo');
      return;
    }
    if (!this.countingGeometry) {
      setText(root, '[data-crossings-detail]', 'sin geometría operacional · conteo deshabilitado');
      return;
    }
    setText(
      root,
      '[data-crossings-detail]',
      `A→B ${this.localCrossings.aToB} · B→A ${this.localCrossings.bToA} · revisión ${this.countingGeometry.revision} · sólo local`,
    );
  }

  private async recordPilotEvidence(snapshot = this.runtime.snapshot()): Promise<void> {
    if (!this.fieldPilotEvidence || !this.pilotPipeline) return;
    try {
      await this.fieldPilotEvidence.observe(
        snapshot,
        this.pilotPipeline.snapshot(),
        this.pilotFrameStats ?? undefined,
      );
      this.evidenceStatus = snapshot.running
        ? 'registrando evidencia piloto local · sin imágenes ni identificadores de tracks'
        : 'evidencia piloto disponible para exportación local';
      this.evidenceError = undefined;
    } catch (error) {
      this.evidenceError = error instanceof Error ? error.message : String(error);
    }
    this.renderEvidenceStatus();
  }

  private async exportPilotEvidence(): Promise<void> {
    if (!this.fieldPilotEvidence) return;
    try {
      const report = await this.fieldPilotEvidence.exportCurrentOrLatest();
      if (!report) {
        this.evidenceStatus = 'todavía no existe una sesión piloto para exportar';
        this.renderEvidenceStatus();
        return;
      }
      const filename = `konta2r-field-pilot-${report.session.sessionId}.json`;
      downloadText(filename, `${JSON.stringify(report, null, 2)}\n`, 'application/json');
      this.evidenceStatus = `evidencia exportada · ${report.summary.sampleCount} muestras · ${formatDuration(report.summary.durationMs)}`;
      this.evidenceError = undefined;
    } catch (error) {
      this.evidenceError = error instanceof Error ? error.message : String(error);
    }
    this.renderEvidenceStatus();
  }

  private renderEvidenceStatus(): void {
    const root = this.root;
    if (!root) return;
    const exportButton = root.querySelector<HTMLButtonElement>('[data-pilot-export]');
    if (exportButton) exportButton.disabled = this.fieldPilotEvidence === null;
    setText(root, '[data-pilot-evidence-status]', this.fieldPilotEvidence
      ? this.evidenceError
        ? `Registro piloto: error local — ${this.evidenceError}`
        : `Registro piloto: ${this.evidenceStatus}`
      : 'Registro piloto: desactivado en el build estándar.');
  }
}
