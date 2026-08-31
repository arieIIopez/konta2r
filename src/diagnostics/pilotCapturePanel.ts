import { hashLocalBenchmarkBlob } from '../detection/localBenchmarkFiles';
import {
  serializePilotCaptureRecord,
  type CaptureConditionRating,
  type CaptureMount,
  type CapturePowerSource,
  type PilotCaptureRecord,
} from '../detection/pilotCaptureRecord';
import { reviewPilotCaptureRecord, type PilotCaptureReview } from '../detection/pilotCaptureReview';
import type { CorpusLighting, CorpusSceneType, CorpusSplit, CorpusViewAngle } from '../detection/corpusManifest';
import { NodeCameraController, type CameraRuntimeState } from '../node/camera';
import {
  chooseInitialNodeProfile,
  detectDeviceCapabilityHints,
  type DeviceCapabilityHints,
  type NodePerformanceProfile,
} from '../node/deviceProfile';

const MAX_RECORDING_MS = 10 * 60 * 1000;
const MIME_CANDIDATES = [
  'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm',
  'video/mp4;codecs=h264', 'video/mp4',
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
  stoppedAtMonotonicMs?: number;
  camera: CameraRuntimeState;
}

function captureId(): string { return `cap-${Date.now().toString(36)}`; }
function esc(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}
function durationText(seconds: number): string {
  const value = Math.max(0, Math.floor(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}
function orientation(width: number, height: number): PilotCaptureRecord['camera']['orientation'] {
  if (width <= 0 || height <= 0) return 'unknown';
  const ratio = width / height;
  return ratio > 1.1 ? 'landscape' : ratio < 0.9 ? 'portrait' : 'square';
}
function selectOption(value: string, current: string, label: string): string {
  return `<option value="${value}" ${value === current ? 'selected' : ''}>${esc(label)}</option>`;
}
function supportedMimeType(): string {
  if (typeof MediaRecorder === 'undefined') throw new Error('MediaRecorder is not supported by this browser');
  return MIME_CANDIDATES.find((value) => MediaRecorder.isTypeSupported(value)) ?? '';
}
function extensionForMime(value: string): string { return value.toLowerCase().includes('mp4') ? 'mp4' : 'webm'; }
function download(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export class PilotCapturePanel {
  private mountElement: HTMLElement | null = null;
  private readonly camera = new NodeCameraController();
  private readonly hints: DeviceCapabilityHints = detectDeviceCapabilityHints();
  private activeStream: MediaStream | null = null;
  private cameraState: CameraRuntimeState = { active: false };
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private snapshot: RecordingSnapshot | null = null;
  private recordingBlob: Blob | null = null;
  private record: PilotCaptureRecord | null = null;
  private review: PilotCaptureReview | null = null;
  private recording = false;
  private busy = false;
  private destroyed = false;
  private timerId: number | null = null;
  private autoStopId: number | null = null;
  private progress = 'Completa la ficha, inicia la cámara y graba un clip piloto local.';
  private error: string | null = null;
  private form: PilotFormState = {
    captureId: captureId(), siteId: '', plannedSplit: 'development', sceneType: 'mixed_traffic', lighting: 'day',
    viewAngle: 'medium_oblique', throughGlass: false, reflections: 'good', sceneOcclusion: 'good',
    cameraStability: 'good', mount: 'fixed', powerSource: 'mains', profile: chooseInitialNodeProfile(this.hints), notes: '',
  };

  mount(element: HTMLElement): void {
    this.mountElement = element;
    this.camera.onUnexpectedEnd(() => {
      if (this.recording) this.stopRecording();
      this.activeStream = null;
      this.cameraState = { active: false };
      this.error = 'La cámara terminó inesperadamente.';
      this.render();
    });
    this.render();
  }

  destroy(): void {
    this.destroyed = true;
    this.clearTimers();
    if (this.recorder?.state !== 'inactive') this.recorder?.stop();
    this.recorder = null;
    this.activeStream = null;
    this.chunks = [];
    this.recordingBlob = null;
    this.camera.onUnexpectedEnd(null);
    void this.camera.stop();
    this.mountElement?.replaceChildren();
    this.mountElement = null;
  }

  private render(): void {
    const root = this.mountElement;
    if (!root || this.destroyed) return;
    const locked = this.recording || this.busy;
    const c = this.cameraState;
    const r = this.record;
    root.innerHTML = `
      <section class="node-runtime-shell pilot-shell">
        <header class="node-runtime-head"><div><div class="eyebrow">Piloto empírico</div><h2>Captura reproducible de secuencia</h2>
          <p>Clips breves para validación. Video y metadata permanecen locales; la ficha excluye domicilio, coordenadas precisas y deviceId de cámara.</p></div>
          <a class="probe-back" href="./?diagnostics=annotate">Ir al anotador</a></header>
        <div class="pilot-layout">
          <section class="pilot-form-card"><h3>Diseño previo a la captura</h3><div class="pilot-form-grid">
            ${this.textInput('captureId', 'captureId', this.form.captureId, locked)}
            ${this.textInput('siteId', 'siteId pseudónimo', this.form.siteId, locked, 'site-001')}
            ${this.select('plannedSplit', 'Split planificado', this.form.plannedSplit, locked, [
              ['development','development · exploración'],['validation','validation · selección'],['held_out_test','held_out_test · evaluación final']])}
            ${this.select('profile', 'Perfil dispositivo', this.form.profile, locked || c.active, [['eco','eco'],['balanced','balanced'],['performance','performance']])}
            ${this.select('sceneType', 'Tipología', this.form.sceneType, locked, [
              ['protected_cycleway','ciclovía protegida'],['unprotected_cycleway','ciclovía no protegida'],['mixed_traffic','tránsito mixto'],
              ['intersection','intersección'],['sidewalk','acera'],['transit_corridor','corredor transporte público'],['shared_space','espacio compartido'],['other','otro']])}
            ${this.select('lighting', 'Iluminación', this.form.lighting, locked, [['day','día'],['backlight','contraluz'],['dusk_dawn','amanecer/atardecer'],['night','noche'],['mixed','mixta']])}
            ${this.select('viewAngle', 'Ángulo', this.form.viewAngle, locked, [['low_oblique','oblicuo bajo'],['medium_oblique','oblicuo medio'],['high_oblique','oblicuo alto'],['near_overhead','casi cenital'],['other','otro']])}
            ${this.select('mount', 'Montaje', this.form.mount, locked, [['fixed','fijo'],['temporary_fixed','fijo temporal'],['handheld','a mano'],['unknown','desconocido']])}
            ${this.rating('reflections', 'Reflejos', this.form.reflections, locked)}
            ${this.rating('sceneOcclusion', 'Oclusión de escena', this.form.sceneOcclusion, locked)}
            ${this.rating('cameraStability', 'Estabilidad', this.form.cameraStability, locked)}
            ${this.select('powerSource', 'Alimentación', this.form.powerSource, locked, [['mains','red eléctrica'],['battery','batería'],['unknown','desconocida']])}
          </div>
          <label class="pilot-check"><input data-field="throughGlass" type="checkbox" ${this.form.throughGlass ? 'checked' : ''} ${locked ? 'disabled' : ''}><span>Captura a través de vidrio</span></label>
          <label class="pilot-notes"><span>Notas de campo</span><textarea data-field="notes" maxlength="500" ${locked ? 'disabled' : ''} placeholder="Condiciones relevantes, sin domicilio ni coordenadas.">${esc(this.form.notes)}</textarea></label>
          <p class="runtime-note">El split se declara <strong>antes</strong> de grabar. El held-out no debe reclasificarse después de observar desempeño.</p></section>

          <section class="pilot-camera-card"><div class="pilot-camera-head"><div><h3>Cámara local</h3><p>${c.active ? `${c.width ?? '—'}×${c.height ?? '—'} · ${c.frameRate?.toFixed(1) ?? '—'} FPS` : 'Cámara detenida'}</p></div>
            <span class="pilot-status ${this.recording ? 'recording' : c.active ? 'ready' : ''}">${this.recording ? 'REC' : c.active ? 'LISTA' : 'OFF'}</span></div>
            <video data-pilot-video class="pilot-video" muted playsinline></video>
            <div class="pilot-actions"><button class="action secondary" data-pilot-camera type="button" ${locked ? 'disabled' : ''}>${c.active ? 'Detener cámara' : 'Iniciar cámara'}</button>
              <button class="action primary" data-pilot-record type="button" ${!c.active || this.busy ? 'disabled' : ''}>${this.recording ? 'Detener grabación' : 'Grabar clip piloto'}</button></div>
            <div class="pilot-device-grid"><div><span>CPU lógica</span><strong>${this.hints.hardwareConcurrency}</strong></div><div><span>Memoria hint</span><strong>${this.hints.deviceMemoryGiB ?? '—'} GiB</strong></div>
              <div><span>WebGPU</span><strong>${this.hints.webgpu ? 'sí' : 'no'}</strong></div><div><span>Perfil</span><strong>${this.form.profile}</strong></div></div>
            <p class="runtime-note">Audio deshabilitado. Máximo 10 minutos por clip. Se registran los settings efectivos entregados por la cámara.</p></section>
        </div>
        <div class="pilot-progress">${esc(this.progress)}</div>${this.error ? `<div class="runtime-error">${esc(this.error)}</div>` : ''}
        ${r ? this.resultHtml(r) : ''}
      </section>`;
    this.attachStream();
    this.bindEvents();
  }

  private textInput(key: 'captureId'|'siteId', label: string, value: string, disabled: boolean, placeholder = ''): string {
    return `<label><span>${label}</span><input data-field="${key}" value="${esc(value)}" placeholder="${esc(placeholder)}" ${disabled ? 'disabled' : ''}></label>`;
  }
  private select(key: string, label: string, current: string, disabled: boolean, values: readonly (readonly [string,string])[]): string {
    return `<label><span>${label}</span><select data-field="${key}" ${disabled ? 'disabled' : ''}>${values.map(([v,l]) => selectOption(v,current,l)).join('')}</select></label>`;
  }
  private rating(key: string, label: string, current: CaptureConditionRating, disabled: boolean): string {
    return this.select(key, label, current, disabled, [['good','buena'],['mixed','mixta'],['poor','difícil'],['unknown','desconocida']]);
  }

  private bindEvents(): void {
    const root = this.mountElement;
    if (!root) return;
    root.querySelectorAll<HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement>('[data-field]').forEach((element) => {
      const event = element instanceof HTMLInputElement && element.type === 'checkbox' ? 'change' : 'input';
      element.addEventListener(event, () => this.readField(element));
    });
    root.querySelector<HTMLButtonElement>('[data-pilot-camera]')?.addEventListener('click', () => void this.toggleCamera());
    root.querySelector<HTMLButtonElement>('[data-pilot-record]')?.addEventListener('click', () => this.recording ? this.stopRecording() : void this.startRecording());
    root.querySelector<HTMLButtonElement>('[data-pilot-download-video]')?.addEventListener('click', () => this.downloadVideo());
    root.querySelector<HTMLButtonElement>('[data-pilot-download-json]')?.addEventListener('click', () => this.downloadJson());
    root.querySelector<HTMLButtonElement>('[data-pilot-clear]')?.addEventListener('click', () => this.clearRecording());
  }

  private readField(element: HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement): void {
    const key = element.dataset.field;
    const value = element instanceof HTMLInputElement && element.type === 'checkbox' ? element.checked : element.value;
    switch (key) {
      case 'captureId': this.form.captureId = String(value); break;
      case 'siteId': this.form.siteId = String(value); break;
      case 'plannedSplit': this.form.plannedSplit = String(value) as CorpusSplit; break;
      case 'profile': this.form.profile = String(value) as NodePerformanceProfile; break;
      case 'sceneType': this.form.sceneType = String(value) as CorpusSceneType; break;
      case 'lighting': this.form.lighting = String(value) as CorpusLighting; break;
      case 'viewAngle': this.form.viewAngle = String(value) as CorpusViewAngle; break;
      case 'mount': this.form.mount = String(value) as CaptureMount; break;
      case 'reflections': this.form.reflections = String(value) as CaptureConditionRating; break;
      case 'sceneOcclusion': this.form.sceneOcclusion = String(value) as CaptureConditionRating; break;
      case 'cameraStability': this.form.cameraStability = String(value) as CaptureConditionRating; break;
      case 'powerSource': this.form.powerSource = String(value) as CapturePowerSource; break;
      case 'throughGlass': this.form.throughGlass = Boolean(value); break;
      case 'notes': this.form.notes = String(value); break;
    }
  }

  private attachStream(): void {
    const video = this.mountElement?.querySelector<HTMLVideoElement>('[data-pilot-video]');
    if (video && this.activeStream) {
      video.srcObject = this.activeStream;
      void video.play().catch(() => undefined);
    }
  }

  private async toggleCamera(): Promise<void> {
    if (this.recording || this.busy) return;
    this.busy = true; this.error = null;
    try {
      if (this.cameraState.active) {
        await this.camera.stop();
        this.activeStream = null;
        this.cameraState = { active: false };
        this.progress = 'Cámara detenida.';
      } else {
        const video = this.mountElement?.querySelector<HTMLVideoElement>('[data-pilot-video]');
        if (!video) throw new Error('Pilot video element is unavailable');
        this.cameraState = await this.camera.start(video, this.form.profile);
        this.activeStream = video.srcObject instanceof MediaStream ? video.srcObject : null;
        if (!this.activeStream) throw new Error('Camera did not expose a MediaStream');
        this.progress = `Cámara activa · ${this.cameraState.width ?? '—'}×${this.cameraState.height ?? '—'} · ${this.cameraState.frameRate?.toFixed(1) ?? '—'} FPS.`;
      }
    } catch (error) {
      this.activeStream = null; this.cameraState = { active: false };
      this.error = error instanceof Error ? error.message : 'pilot_camera_failed';
    } finally { this.busy = false; this.render(); }
  }

  private async startRecording(): Promise<void> {
    if (!this.activeStream || this.recording || this.busy) return;
    this.form.captureId = this.form.captureId.trim(); this.form.siteId = this.form.siteId.trim();
    if (!this.form.captureId || !this.form.siteId) { this.error = 'captureId y siteId pseudónimo son obligatorios.'; this.render(); return; }
    try {
      const mime = supportedMimeType();
      const recorder = mime ? new MediaRecorder(this.activeStream, { mimeType: mime }) : new MediaRecorder(this.activeStream);
      const camera = this.camera.state();
      if (!camera.width || !camera.height || !camera.frameRate) throw new Error('Camera did not expose effective width/height/frameRate');
      this.snapshot = { form: { ...this.form }, startedAtIso: new Date().toISOString(), startedAtMonotonicMs: performance.now(), camera };
      this.recordingBlob = null; this.record = null; this.review = null; this.chunks = []; this.recorder = recorder;
      recorder.addEventListener('dataavailable', (event) => { if (event.data.size > 0) this.chunks.push(event.data); });
      recorder.addEventListener('stop', () => void this.finalizeRecording(recorder.mimeType || mime || 'video/webm'), { once: true });
      recorder.start(1000); this.recording = true; this.error = null;
      this.progress = 'Grabando clip piloto · 0:00 / 10:00';
      this.timerId = window.setInterval(() => this.updateTimer(), 1000);
      this.autoStopId = window.setTimeout(() => this.stopRecording(), MAX_RECORDING_MS);
      this.render();
    } catch (error) {
      this.snapshot = null; this.recorder = null; this.recording = false;
      this.error = error instanceof Error ? error.message : 'pilot_recording_start_failed'; this.render();
    }
  }

  private stopRecording(): void {
    if (!this.recorder || this.recorder.state === 'inactive') return;
    this.clearTimers();
    if (this.snapshot) this.snapshot.stoppedAtMonotonicMs = performance.now();
    this.recording = false; this.busy = true; this.progress = 'Cerrando clip y calculando SHA-256…';
    this.recorder.stop(); this.render();
  }

  private async finalizeRecording(mimeType: string): Promise<void> {
    const snapshot = this.snapshot;
    if (!snapshot || this.destroyed) return;
    try {
      const blob = new Blob(this.chunks, { type: mimeType });
      if (blob.size <= 0) throw new Error('Recorded pilot clip is empty');
      const sha256 = await hashLocalBenchmarkBlob(blob, { onProgress: (p) => { this.progress = `Hash video ${(p.ratio * 100).toFixed(0)}%`; this.updateProgress(); } });
      if (this.destroyed) return;
      const stopped = snapshot.stoppedAtMonotonicMs ?? performance.now();
      const durationSeconds = Math.max(0.001, (stopped - snapshot.startedAtMonotonicMs) / 1000);
      const width = snapshot.camera.width ?? 0, height = snapshot.camera.height ?? 0, frameRate = snapshot.camera.frameRate ?? 0;
      const notes = snapshot.form.notes.split('\n').map((x) => x.trim()).filter(Boolean);
      const record: PilotCaptureRecord = {
        schemaVersion: '1', recordType: 'konta2r_pilot_capture', captureId: snapshot.form.captureId, siteId: snapshot.form.siteId,
        plannedSplit: snapshot.form.plannedSplit, startedAtIso: snapshot.startedAtIso, durationSeconds,
        scene: { sceneType: snapshot.form.sceneType, lighting: snapshot.form.lighting, viewAngle: snapshot.form.viewAngle,
          throughGlass: snapshot.form.throughGlass, reflections: snapshot.form.reflections, sceneOcclusion: snapshot.form.sceneOcclusion, cameraStability: snapshot.form.cameraStability },
        camera: { width, height, frameRate, orientation: orientation(width,height), mount: snapshot.form.mount,
          ...(snapshot.camera.facingMode === undefined ? {} : { facingMode: snapshot.camera.facingMode }) },
        device: { profile: snapshot.form.profile, hardwareConcurrency: this.hints.hardwareConcurrency, webgpu: this.hints.webgpu,
          powerSource: snapshot.form.powerSource, ...(this.hints.deviceMemoryGiB === undefined ? {} : { deviceMemoryGiB: this.hints.deviceMemoryGiB }), userAgent: navigator.userAgent },
        media: { sha256, sizeBytes: blob.size, mimeType: blob.type || mimeType }, ...(notes.length ? { notes } : {}),
      };
      serializePilotCaptureRecord(record);
      this.recordingBlob = blob; this.record = record; this.review = reviewPilotCaptureRecord(record);
      this.progress = `Clip listo · ${durationText(durationSeconds)} · ${(blob.size/1048576).toFixed(1)} MB · SHA ${sha256.slice(0,12)}…`;
    } catch (error) {
      this.recordingBlob = null; this.record = null; this.review = null;
      this.error = error instanceof Error ? error.message : 'pilot_recording_finalize_failed';
      this.progress = 'El clip no pudo convertirse en evidencia reproducible.';
    } finally {
      this.chunks = []; this.recorder = null; this.snapshot = null; this.busy = false; this.render();
    }
  }

  private resultHtml(record: PilotCaptureRecord): string {
    return `<section class="pilot-result"><div class="pilot-result-grid">
      <div><span>Captura</span><strong>${esc(record.captureId)}</strong></div><div><span>Split</span><strong>${record.plannedSplit}</strong></div>
      <div><span>Duración</span><strong>${durationText(record.durationSeconds)}</strong></div><div><span>Video</span><strong>${record.camera.width}×${record.camera.height} @ ${record.camera.frameRate.toFixed(1)}</strong></div>
      <div><span>SHA-256</span><strong class="mono">${record.media?.sha256.slice(0,12) ?? '—'}…</strong></div><div><span>Tamaño</span><strong>${record.media ? `${(record.media.sizeBytes/1048576).toFixed(1)} MB` : '—'}</strong></div>
      </div>${this.reviewHtml()}<div class="pilot-actions"><button class="action secondary" data-pilot-download-video>Guardar video</button><button class="action secondary" data-pilot-download-json>Guardar ficha JSON</button><button class="action secondary" data-pilot-clear>Liberar clip</button></div></section>`;
  }
  private reviewHtml(): string {
    if (!this.review || this.review.findings.length === 0) return '<div class="pilot-findings"><p>Sin observaciones automáticas. Esto no equivale a representatividad.</p></div>';
    return `<div class="pilot-findings">${this.review.findings.map((f) => `<p class="${f.severity}"><b>${f.severity === 'warning' ? 'Revisar' : 'Información'} · ${esc(f.code)}</b> — ${esc(f.message)}</p>`).join('')}</div>`;
  }
  private updateTimer(): void {
    if (!this.snapshot || !this.recording) return;
    this.progress = `Grabando clip piloto · ${durationText((performance.now()-this.snapshot.startedAtMonotonicMs)/1000)} / 10:00`; this.updateProgress();
  }
  private updateProgress(): void { const el = this.mountElement?.querySelector<HTMLElement>('.pilot-progress'); if (el) el.textContent = this.progress; }
  private clearTimers(): void {
    if (this.timerId !== null) clearInterval(this.timerId); if (this.autoStopId !== null) clearTimeout(this.autoStopId); this.timerId = null; this.autoStopId = null;
  }
  private downloadVideo(): void {
    if (!this.recordingBlob || !this.record) return;
    download(`${this.record.captureId}.${extensionForMime(this.record.media?.mimeType ?? this.recordingBlob.type)}`, this.recordingBlob);
  }
  private downloadJson(): void {
    if (!this.record) return;
    download(`${this.record.captureId}-capture.json`, new Blob([serializePilotCaptureRecord(this.record)], { type:'application/json;charset=utf-8' }));
  }
  private clearRecording(): void {
    this.recordingBlob = null; this.record = null; this.review = null; this.form.captureId = captureId();
    this.progress = 'Clip liberado de memoria. Puedes preparar una nueva captura.'; this.render();
  }
}
