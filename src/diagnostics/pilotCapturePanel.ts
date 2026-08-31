import { hashLocalBenchmarkBlob } from '../detection/localBenchmarkFiles';
import {
  serializePilotCaptureRecord,
  type CaptureConditionRating,
  type CaptureMount,
  type CapturePowerSource,
  type PilotCaptureRecord,
} from '../detection/pilotCaptureRecord';
import { reviewPilotCaptureRecord, type PilotCaptureReview } from '../detection/pilotCaptureReview';
import type {
  CorpusLighting,
  CorpusSceneType,
  CorpusSplit,
  CorpusViewAngle,
} from '../detection/corpusManifest';
import { NodeCameraController, type CameraRuntimeState } from '../node/camera';
import {
  chooseInitialNodeProfile,
  detectDeviceCapabilityHints,
  type DeviceCapabilityHints,
  type NodePerformanceProfile,
} from '../node/deviceProfile';

const MAX_RECORDING_MS = 10 * 60 * 1000;
const MIME_CANDIDATES = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
  'video/mp4;codecs=h264',
  'video/mp4',
] as const;

interface PilotFormState {
  captureId: string;
  siteId: string;
  plannedSplit: CorpusSplit;
  sceneType: CorpusSceneType;
  lighting: CorpusLighting;
  viewAngle: CorpusViewAngle;
  throughGlass: boolean;
  reflections: CaptureConditionRating;
  sceneOcclusion: CaptureConditionRating;
  cameraStability: CaptureConditionRating;
  mount: CaptureMount;
  powerSource: CapturePowerSource;
  profile: NodePerformanceProfile;
  notes: string;
}

interface RecordingSnapshot {
  form: PilotFormState;
  startedAtIso: string;
  startedAtMonotonicMs: number;
  camera: CameraRuntimeState;
}

function opaqueCaptureId(): string {
  return `cap-${Date.now().toString(36)}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function durationText(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60);
  const remainder = whole % 60;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function orientation(width: number, height: number): PilotCaptureRecord['camera']['orientation'] {
  if (width <= 0 || height <= 0) return 'unknown';
  const ratio = width / height;
  if (ratio > 1.1) return 'landscape';
  if (ratio < 0.9) return 'portrait';
  return 'square';
}

function supportedMimeType(): string {
  if (typeof MediaRecorder === 'undefined') throw new Error('MediaRecorder is not supported by this browser');
  for (const candidate of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  return '';
}

function extensionForMime(mimeType: string): string {
  return mimeType.toLowerCase().includes('mp4') ? 'mp4' : 'webm';
}

function cloneForm(value: PilotFormState): PilotFormState {
  return { ...value };
}

function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function downloadText(filename: string, text: string): void {
  downloadBlob(filename, new Blob([text], { type: 'application/json;charset=utf-8' }));
}

function option<T extends string>(value: T, current: string, label: string): string {
  return `<option value="${value}" ${value === current ? 'selected' : ''}>${escapeHtml(label)}</option>`;
}

export class PilotCapturePanel {
  private mountElement: HTMLElement | null = null;
  private readonly camera = new NodeCameraController();
  private readonly hints: DeviceCapabilityHints = detectDeviceCapabilityHints();
  private cameraState: CameraRuntimeState = { active: false };
  private form: PilotFormState = {
    captureId: opaqueCaptureId(),
    siteId: '',
    plannedSplit: 'development',
    sceneType: 'mixed_traffic',
    lighting: 'day',
    viewAngle: 'medium_oblique',
    throughGlass: false,
    reflections: 'good',
    sceneOcclusion: 'good',
    cameraStability: 'good',
    mount: 'fixed',
    powerSource: 'mains',
    profile: chooseInitialNodeProfile(this.hints),
    notes: '',
  };
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private snapshot: RecordingSnapshot | null = null;
  private recordingBlob: Blob | null = null;
  private record: PilotCaptureRecord | null = null;
  private review: PilotCaptureReview | null = null;
  private recording = false;
  private busy = false;
  private destroyed = false;
  private progress = 'Completa la ficha, inicia la cámara y luego graba un clip piloto local.';
  private error: string | null = null;
  private timerId: number | null = null;
  private autoStopId: number | null = null;

  mount(element: HTMLElement): void {
    this.mountElement = element;
    this.camera.onUnexpectedEnd(() => {
      if (this.recording) this.stopRecording();
      this.cameraState = { active: false };
      this.error = 'La cámara terminó inesperadamente.';
      this.render();
    });
    this.render();
  }

  destroy(): void {
    this.destroyed = true;
    this.clearTimers();
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    this.recorder = null;
    this.chunks = [];
    this.recordingBlob = null;
    this.record = null;
    this.review = null;
    this.camera.onUnexpectedEnd(null);
    void this.camera.stop();
    this.mountElement?.replaceChildren();
    this.mountElement = null;
  }

  private render(): void {
    const mount = this.mountElement;
    if (!mount || this.destroyed) return;
    const locked = this.recording || this.busy;
    const camera = this.cameraState;
    const record = this.record;
    const review = this.review;

    mount.innerHTML = `
      <section class="node-runtime-shell pilot-shell">
        <header class="node-runtime-head">
          <div>
            <div class="eyebrow">Piloto empírico</div>
            <h2>Captura reproducible de secuencia</h2>
            <p>Registra clips breves para validación del detector. Video y metadata permanecen locales; la ficha excluye domicilio, coordenadas precisas y deviceId de cámara.</p>
          </div>
          <a class="probe-back" href="./?diagnostics=annotate">Ir al anotador</a>
        </header>

        <div class="pilot-layout">
          <section class="pilot-form-card">
            <h3>Diseño previo a la captura</h3>
            <div class="pilot-form-grid">
              <label><span>captureId</span><input data-field="captureId" value="${escapeHtml(this.form.captureId)}" ${locked ? 'disabled' : ''}></label>
              <label><span>siteId pseudónimo</span><input data-field="siteId" placeholder="site-001" value="${escapeHtml(this.form.siteId)}" ${locked ? 'disabled' : ''}></label>
              <label><span>Split planificado</span><select data-field="plannedSplit" ${locked ? 'disabled' : ''}>
                ${option('development', this.form.plannedSplit, 'development · exploración')}
                ${option('validation', this.form.plannedSplit, 'validation · selección')}
                ${option('held_out_test', this.form.plannedSplit, 'held_out_test · evaluación final')}
              </select></label>
              <label><span>Perfil dispositivo</span><select data-field="profile" ${locked || camera.active ? 'disabled' : ''}>
                ${option('eco', this.form.profile, 'eco')}${option('balanced', this.form.profile, 'balanced')}${option('performance', this.form.profile, 'performance')}
              </select></label>
              <label><span>Tipología</span><select data-field="sceneType" ${locked ? 'disabled' : ''}>
                ${option('protected_cycleway', this.form.sceneType, 'ciclovía protegida')}
                ${option('unprotected_cycleway', this.form.sceneType, 'ciclovía no protegida')}
                ${option('mixed_traffic', this.form.sceneType, 'tránsito mixto')}
                ${option('intersection', this.form.sceneType, 'intersección')}
                ${option('sidewalk', this.form.sceneType, 'acera')}
                ${option('transit_corridor', this.form.sceneType, 'corredor transporte público')}
                ${option('shared_space', this.form.sceneType, 'espacio compartido')}
                ${option('other', this.form.sceneType, 'otro')}
              </select></label>
              <label><span>Iluminación</span><select data-field="lighting" ${locked ? 'disabled' : ''}>
                ${option('day', this.form.lighting, 'día')}${option('backlight', this.form.lighting, 'contraluz')}${option('dusk_dawn', this.form.lighting, 'amanecer/atardecer')}${option('night', this.form.lighting, 'noche')}${option('mixed', this.form.lighting, 'mixta')}
              </select></label>
              <label><span>Ángulo</span><select data-field="viewAngle" ${locked ? 'disabled' : ''}>
                ${option('low_oblique', this.form.viewAngle, 'oblicuo bajo')}${option('medium_oblique', this.form.viewAngle, 'oblicuo medio')}${option('high_oblique', this.form.viewAngle, 'oblicuo alto')}${option('near_overhead', this.form.viewAngle, 'casi cenital')}${option('other', this.form.viewAngle, 'otro')}
              </select></label>
              <label><span>Montaje</span><select data-field="mount" ${locked ? 'disabled' : ''}>
                ${option('fixed', this.form.mount, 'fijo')}${option('temporary_fixed', this.form.mount, 'fijo temporal')}${option('handheld', this.form.mount, 'a mano')}${option('unknown', this.form.mount, 'desconocido')}
              </select></label>
              ${this.ratingSelect('reflections', 'Reflejos', this.form.reflections, locked)}
              ${this.ratingSelect('sceneOcclusion', 'Oclusión de escena', this.form.sceneOcclusion, locked)}
              ${this.ratingSelect('cameraStability', 'Estabilidad', this.form.cameraStability, locked)}
              <label><span>Alimentación</span><select data-field="powerSource" ${locked ? 'disabled' : ''}>
                ${option('mains', this.form.powerSource, 'red eléctrica')}${option('battery', this.form.powerSource, 'batería')}${option('unknown', this.form.powerSource, 'desconocida')}
              </select></label>
            </div>
            <label class="pilot-check"><input data-field="throughGlass" type="checkbox" ${this.form.throughGlass ? 'checked' : ''} ${locked ? 'disabled' : ''}><span>Captura a través de vidrio</span></label>
            <label class="pilot-notes"><span>Notas de campo</span><textarea data-field="notes" maxlength="500" ${locked ? 'disabled' : ''} placeholder="Condiciones observacionales relevantes, sin domicilio ni coordenadas.">${escapeHtml(this.form.notes)}</textarea></label>
            <p class="runtime-note">El split se declara <strong>antes</strong> de grabar. Una secuencia held-out no debe reclasificarse después de mirar resultados del detector.</p>
          </section>

          <section class="pilot-camera-card">
            <div class="pilot-camera-head">
              <div><h3>Cámara local</h3><p>${camera.active ? `${camera.width ?? '—'}×${camera.height ?? '—'} · ${camera.frameRate?.toFixed(1) ?? '—'} FPS` : 'Cámara detenida'}</p></div>
              <span class="pilot-status ${this.recording ? 'recording' : camera.active ? 'ready' : ''}">${this.recording ? 'REC' : camera.active ? 'LISTA' : 'OFF'}</span>
            </div>
            <video data-pilot-video class="pilot-video" muted playsinline></video>
            <div class="pilot-actions">
              <button class="action secondary" data-pilot-camera type="button" ${locked ? 'disabled' : ''}>${camera.active ? 'Detener cámara' : 'Iniciar cámara'}</button>
              <button class="action primary" data-pilot-record type="button" ${!camera.active || this.busy ? 'disabled' : ''}>${this.recording ? 'Detener grabación' : 'Grabar clip piloto'}</button>
            </div>
            <div class="pilot-device-grid">
              <div><span>CPU lógica</span><strong>${this.hints.hardwareConcurrency}</strong></div>
              <div><span>Memoria hint</span><strong>${this.hints.deviceMemoryGiB ?? '—'} GiB</strong></div>
              <div><span>WebGPU</span><strong>${this.hints.webgpu ? 'sí' : 'no'}</strong></div>
              <div><span>Perfil</span><strong>${this.form.profile}</strong></div>
            </div>
            <p class="runtime-note">Audio deshabilitado. Límite automático por clip: 10 minutos. Los settings mostrados son los observados por la cámara, no solo los solicitados por constraints.</p>
          </section>
        </div>

        <div class="pilot-progress">${escapeHtml(this.progress)}</div>
        ${this.error ? `<div class="runtime-error">${escapeHtml(this.error)}</div>` : ''}

        ${record ? `
          <section class="pilot-result">
            <div class="pilot-result-grid">
              <div><span>Captura</span><strong>${escapeHtml(record.captureId)}</strong></div>
              <div><span>Split planificado</span><strong>${record.plannedSplit}</strong></div>
              <div><span>Duración</span><strong>${durationText(record.durationSeconds)}</strong></div>
              <div><span>Video</span><strong>${record.camera.width}×${record.camera.height} @ ${record.camera.frameRate.toFixed(1)}</strong></div>
              <div><span>SHA-256</span><strong class="mono">${record.media?.sha256.slice(0, 12) ?? '—'}…</strong></div>
              <div><span>Tamaño</span><strong>${record.media ? `${(record.media.sizeBytes / 1048576).toFixed(1)} MB` : '—'}</strong></div>
            </div>
            ${review ? this.reviewHtml(review) : ''}
            <div class="pilot-actions">
              <button class="action secondary" data-pilot-download-video type="button">Guardar video</button>
              <button class="action secondary" data-pilot-download-json type="button">Guardar ficha JSON</button>
              <button class="action secondary" data-pilot-clear type="button">Liberar clip</button>
            </div>
          </section>
        ` : ''}
      </section>
    `;

    this.restoreVideoStream();
    this.bindForm();
    mount.querySelector<HTMLButtonElement>('[data-pilot-camera]')?.addEventListener('click', () => void this.toggleCamera());
    mount.querySelector<HTMLButtonElement>('[data-pilot-record]')?.addEventListener('click', () => {
      if (this.recording) this.stopRecording(); else void this.startRecording();
    });
    mount.querySelector<HTMLButtonElement>('[data-pilot-download-video]')?.addEventListener('click', () => this.downloadVideo());
    mount.querySelector<HTMLButtonElement>('[data-pilot-download-json]')?.addEventListener('click', () => this.downloadJson());
    mount.querySelector<HTMLButtonElement>('[data-pilot-clear]')?.addEventListener('click', () => this.clearRecording());
  }

  private ratingSelect(key: 'reflections' | 'sceneOcclusion' | 'cameraStability', label: string, current: CaptureConditionRating, locked: boolean): string {
    return `<label><span>${label}</span><select data-field="${key}" ${locked ? 'disabled' : ''}>
      ${option('good', current, 'buena')}${option('mixed', current, 'mixta')}${option('poor', current, 'difícil')}${option('unknown', current, 'desconocida')}
    </select></label>`;
  }

  private bindForm(): void {
    const mount = this.mountElement;
    if (!mount) return;
    const textKeys = ['captureId', 'siteId', 'notes'] as const;
    for (const key of textKeys) {
      mount.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-field="${key}"]`)?.addEventListener('input', (event) => {
        this.form[key] = (event.currentTarget as HTMLInputElement | HTMLTextAreaElement).value;
      });
    }
    const selectKeys = ['plannedSplit', 'profile', 'sceneType', 'lighting', 'viewAngle', 'mount', 'reflections', 'sceneOcclusion', 'cameraStability', 'powerSource'] as const;
    for (const key of selectKeys) {
      mount.querySelector<HTMLSelectElement>(`[data-field="${key}"]`)?.addEventListener('change', (event) => {
        const value = (event.currentTarget as HTMLSelectElement).value;
        (this.form as unknown as Record<string, string>)[key] = value;
      });
    }
    mount.querySelector<HTMLInputElement>('[data-field="throughGlass"]')?.addEventListener('change', (event) => {
      this.form.throughGlass = (event.currentTarget as HTMLInputElement).checked;
    });
  }

  private async toggleCamera(): Promise<void> {
    if (this.recording || this.busy) return;
    this.error = null;
    this.busy = true;
    this.render();
    try {
      if (this.cameraState.active) {
        await this.camera.stop();
        this.cameraState = { active: false };
        this.progress = 'Cámara detenida.';
      } else {
        const video = this.mountElement?.querySelector<HTMLVideoElement>('[data-pilot-video]');
        if (!video) throw new Error('Pilot video element is unavailable');
        this.cameraState = await this.camera.start(video, this.form.profile);
        this.progress = `Cámara activa · ${this.cameraState.width ?? '—'}×${this.cameraState.height ?? '—'} · ${this.cameraState.frameRate?.toFixed(1) ?? '—'} FPS.`;
      }
    } catch (error) {
      this.cameraState = { active: false };
      this.error = error instanceof Error ? error.message : 'pilot_camera_failed';
      this.progress = 'No fue posible preparar la cámara local.';
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private restoreVideoStream(): void {
    if (!this.cameraState.active) return;
    const video = this.mountElement?.querySelector<HTMLVideoElement>('[data-pilot-video]');
    if (!video) return;
    const previous = document.querySelector<HTMLVideoElement>('video[data-pilot-stream-source]');
    if (previous?.srcObject) video.srcObject = previous.srcObject;
    if (!video.srcObject) {
      // NodeCameraController retains the stream internally; re-rendering cannot
      // read it directly. Avoid a render during active preview except transitions.
      return;
    }
  }

  private async startRecording(): Promise<void> {
    if (!this.cameraState.active || this.recording || this.busy) return;
    const siteId = this.form.siteId.trim();
    const captureId = this.form.captureId.trim();
    if (!siteId || !captureId) {
      this.error = 'captureId y siteId pseudónimo son obligatorios antes de grabar.';
      this.render();
      return;
    }
    const video = this.mountElement?.querySelector<HTMLVideoElement>('[data-pilot-video]');
    const stream = video?.srcObject;
    if (!(stream instanceof MediaStream)) {
      this.error = 'La cámara local no tiene un MediaStream disponible.';
      this.render();
      return;
    }

    try {
      const mimeType = supportedMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      const state = this.camera.state();
      if (!state.width || !state.height || !state.frameRate) throw new Error('Camera did not expose effective width/height/frameRate');
      this.form.captureId = captureId;
      this.form.siteId = siteId;
      this.snapshot = {
        form: cloneForm(this.form),
        startedAtIso: new Date().toISOString(),
        startedAtMonotonicMs: performance.now(),
        camera: state,
      };
      this.chunks = [];
      this.recordingBlob = null;
      this.record = null;
      this.review = null;
      this.recorder = recorder;
      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) this.chunks.push(event.data);
      });
      recorder.addEventListener('stop', () => void this.finalizeRecording(recorder.mimeType || mimeType || 'video/webm'), { once: true });
      recorder.start(1000);
      this.recording = true;
      this.error = null;
      this.progress = 'Grabando clip piloto · 0:00 / 10:00';
      this.timerId = window.setInterval(() => this.updateRecordingProgress(), 1000);
      this.autoStopId = window.setTimeout(() => this.stopRecording(), MAX_RECORDING_MS);
      this.renderWithoutLosingStream(stream);
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'pilot_recording_start_failed';
      this.progress = 'No fue posible iniciar la grabación.';
      this.recording = false;
      this.recorder = null;
      this.snapshot = null;
      this.render();
    }
  }

  private stopRecording(): void {
    if (!this.recorder || this.recorder.state === 'inactive') return;
    this.clearTimers();
    this.progress = 'Cerrando clip y calculando evidencia…';
    this.busy = true;
    this.recording = false;
    this.recorder.stop();
    this.renderPreservingCurrentStream();
  }

  private async finalizeRecording(mimeType: string): Promise<void> {
    const snapshot = this.snapshot;
    if (!snapshot || this.destroyed) return;
    try {
      const blob = new Blob(this.chunks, { type: mimeType });
      if (blob.size <= 0) throw new Error('Recorded pilot clip is empty');
      this.progress = 'Calculando SHA-256 incremental del video local…';
      this.updateProgressElement();
      const sha256 = await hashLocalBenchmarkBlob(blob, {
        onProgress: (value) => {
          this.progress = `Hash video ${(value.ratio * 100).toFixed(0)}%`;
          this.updateProgressElement();
        },
      });
      if (this.destroyed) return;
      const durationSeconds = Math.max(0.001, (performance.now() - snapshot.startedAtMonotonicMs) / 1000);
      const width = snapshot.camera.width ?? 0;
      const height = snapshot.camera.height ?? 0;
      const frameRate = snapshot.camera.frameRate ?? 0;
      const notes = snapshot.form.notes.split('\n').map((value) => value.trim()).filter(Boolean);
      const record: PilotCaptureRecord = {
        schemaVersion: '1',
        recordType: 'konta2r_pilot_capture',
        captureId: snapshot.form.captureId,
        siteId: snapshot.form.siteId,
        plannedSplit: snapshot.form.plannedSplit,
        startedAtIso: snapshot.startedAtIso,
        durationSeconds,
        scene: {
          sceneType: snapshot.form.sceneType,
          lighting: snapshot.form.lighting,
          viewAngle: snapshot.form.viewAngle,
          throughGlass: snapshot.form.throughGlass,
          reflections: snapshot.form.reflections,
          sceneOcclusion: snapshot.form.sceneOcclusion,
          cameraStability: snapshot.form.cameraStability,
        },
        camera: {
          width,
          height,
          frameRate,
          orientation: orientation(width, height),
          mount: snapshot.form.mount,
          ...(snapshot.camera.facingMode === undefined ? {} : { facingMode: snapshot.camera.facingMode }),
        },
        device: {
          profile: snapshot.form.profile,
          hardwareConcurrency: this.hints.hardwareConcurrency,
          webgpu: this.hints.webgpu,
          powerSource: snapshot.form.powerSource,
          ...(this.hints.deviceMemoryGiB === undefined ? {} : { deviceMemoryGiB: this.hints.deviceMemoryGiB }),
          userAgent: navigator.userAgent,
        },
        media: { sha256, sizeBytes: blob.size, mimeType: blob.type || mimeType },
        ...(notes.length === 0 ? {} : { notes }),
      };
      serializePilotCaptureRecord(record);
      this.recordingBlob = blob;
      this.record = record;
      this.review = reviewPilotCaptureRecord(record);
      this.progress = `Clip listo · ${durationText(durationSeconds)} · ${(blob.size / 1048576).toFixed(1)} MB · SHA ${sha256.slice(0, 12)}…`;
    } catch (error) {
      this.recordingBlob = null;
      this.record = null;
      this.review = null;
      this.error = error instanceof Error ? error.message : 'pilot_recording_finalize_failed';
      this.progress = 'El clip no pudo convertirse en evidencia reproducible.';
    } finally {
      this.chunks = [];
      this.recorder = null;
      this.snapshot = null;
      this.busy = false;
      this.renderPreservingCurrentStream();
    }
  }

  private renderWithoutLosingStream(stream: MediaStream): void {
    this.render();
    const video = this.mountElement?.querySelector<HTMLVideoElement>('[data-pilot-video]');
    if (video) {
      video.srcObject = stream;
      video.dataset.pilotStreamSource = 'true';
      void video.play().catch(() => undefined);
    }
  }

  private renderPreservingCurrentStream(): void {
    const oldVideo = this.mountElement?.querySelector<HTMLVideoElement>('[data-pilot-video]');
    const stream = oldVideo?.srcObject instanceof MediaStream ? oldVideo.srcObject : null;
    this.render();
    const video = this.mountElement?.querySelector<HTMLVideoElement>('[data-pilot-video]');
    if (video && stream) {
      video.srcObject = stream;
      video.dataset.pilotStreamSource = 'true';
      void video.play().catch(() => undefined);
    }
  }

  private updateRecordingProgress(): void {
    const snapshot = this.snapshot;
    if (!snapshot || !this.recording) return;
    const elapsed = (performance.now() - snapshot.startedAtMonotonicMs) / 1000;
    this.progress = `Grabando clip piloto · ${durationText(elapsed)} / 10:00`;
    this.updateProgressElement();
  }

  private updateProgressElement(): void {
    const node = this.mountElement?.querySelector<HTMLElement>('.pilot-progress');
    if (node) node.textContent = this.progress;
  }

  private reviewHtml(review: PilotCaptureReview): string {
    if (review.findings.length === 0) return '<div class="pilot-findings"><p>Sin observaciones automáticas para esta ficha. Esto no constituye un veredicto de representatividad.</p></div>';
    return `<div class="pilot-findings">${review.findings.map((finding) => `<p class="${finding.severity}"><b>${finding.severity === 'warning' ? 'Revisar' : 'Información'} · ${escapeHtml(finding.code)}</b> — ${escapeHtml(finding.message)}</p>`).join('')}</div>`;
  }

  private downloadVideo(): void {
    const blob = this.recordingBlob;
    const record = this.record;
    if (!blob || !record) return;
    downloadBlob(`${record.captureId}.${extensionForMime(record.media?.mimeType ?? blob.type)}`, blob);
  }

  private downloadJson(): void {
    const record = this.record;
    if (!record) return;
    downloadText(`${record.captureId}-capture.json`, serializePilotCaptureRecord(record));
  }

  private clearRecording(): void {
    this.recordingBlob = null;
    this.record = null;
    this.review = null;
    this.form.captureId = opaqueCaptureId();
    this.progress = 'Clip liberado de memoria. Puedes preparar una nueva captura.';
    this.renderPreservingCurrentStream();
  }

  private clearTimers(): void {
    if (this.timerId !== null) window.clearInterval(this.timerId);
    if (this.autoStopId !== null) window.clearTimeout(this.autoStopId);
    this.timerId = null;
    this.autoStopId = null;
  }
}
