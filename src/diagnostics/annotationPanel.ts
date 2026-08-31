import {
  addAnnotationFrame,
  addGroundTruthObject,
  createAnnotationDraft,
  DETECTOR_GROUND_TRUTH_CLASSES,
  removeAnnotationFrame,
  removeGroundTruthObject,
  restoreAnnotationDraft,
  serializeAnnotationDraft,
  type AnnotationDraft,
  type DetectorGroundTruthClass,
} from '../detection/annotationDraft';
import { parseAnnotatedBenchmarkSequenceJson } from '../detection/benchmarkDatasetParser';
import type {
  AnnotatedBenchmarkFrame,
  GroundTruthObject,
  GroundTruthOcclusion,
} from '../detection/benchmarkDataset';

interface DraftRectangle {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

interface VideoWithFrameCallback extends HTMLVideoElement {
  requestVideoFrameCallback?: (
    callback: (now: number, metadata: { mediaTime: number }) => void,
  ) => number;
}

function safeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'annotations';
}

function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function formatTime(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return '—';
  return `${(ms / 1000).toFixed(3)} s`;
}

function html(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

async function presentedMediaTimeMs(video: HTMLVideoElement): Promise<number> {
  const candidate = video as VideoWithFrameCallback;
  if (!candidate.requestVideoFrameCallback) return video.currentTime * 1000;
  return new Promise<number>((resolve) => {
    let settled = false;
    const finish = (value: number) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(fallback);
      resolve(value);
    };
    const fallback = window.setTimeout(() => finish(video.currentTime * 1000), 250);
    candidate.requestVideoFrameCallback?.((_now, metadata) => finish(metadata.mediaTime * 1000));
  });
}

function waitForSeek(video: HTMLVideoElement, seconds: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
    };
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('Video seek failed'));
    };
    video.addEventListener('seeked', onSeeked, { once: true });
    video.addEventListener('error', onError, { once: true });
    video.currentTime = Math.max(0, seconds);
    if (Math.abs(video.currentTime - seconds) < 0.0005 && video.readyState >= 2) {
      window.setTimeout(onSeeked, 0);
    }
  });
}

export class AnnotationPanel {
  private mountElement: HTMLElement | null = null;
  private draft: AnnotationDraft = createAnnotationDraft('konta2r-pilot', 'sequence-001');
  private activeFrameId: string | null = null;
  private selectedAnnotationId: string | null = null;
  private videoFile: File | null = null;
  private videoUrl: string | null = null;
  private drawing: DraftRectangle | null = null;
  private className: DetectorGroundTruthClass = 'person';
  private occlusion: GroundTruthOcclusion = 'none';
  private ignore = false;
  private message = 'Selecciona un video local y captura frames representativos.';
  private error: string | null = null;
  private destroyed = false;

  mount(element: HTMLElement): void {
    this.mountElement = element;
    this.render();
  }

  destroy(): void {
    this.destroyed = true;
    this.revokeVideoUrl();
    this.mountElement?.replaceChildren();
    this.mountElement = null;
  }

  private activeFrame(): AnnotatedBenchmarkFrame | null {
    return this.draft.frames.find((frame) => frame.frameId === this.activeFrameId) ?? null;
  }

  private render(): void {
    const mount = this.mountElement;
    if (!mount || this.destroyed) return;
    const frame = this.activeFrame();
    const activeIndex = frame ? this.draft.frames.findIndex((value) => value.frameId === frame.frameId) : -1;
    const videoLabel = this.videoFile ? `${html(this.videoFile.name)} · ${(this.videoFile.size / 1048576).toFixed(1)} MB` : 'Ningún video seleccionado';

    mount.innerHTML = `
      <section class="node-runtime-shell annotation-shell">
        <header class="node-runtime-head">
          <div>
            <div class="eyebrow">Ground truth local</div>
            <h2>Anotador de corpus de detección</h2>
            <p>Selecciona frames representativos y dibuja cajas en coordenadas de la resolución original. Esta superficie genera directamente <code>AnnotatedBenchmarkSequence</code>.</p>
          </div>
          <a class="probe-back" href="./">Volver al nodo</a>
        </header>

        <div class="annotation-meta">
          <label><span>Dataset ID</span><input data-annotation-dataset value="${html(this.draft.datasetId)}"></label>
          <label><span>Sequence ID</span><input data-annotation-sequence value="${html(this.draft.sequenceId)}"></label>
          <label class="annotation-file-action"><span>Video local</span><strong>${videoLabel}</strong><input data-annotation-video type="file" accept="video/*"></label>
          <label class="annotation-file-action"><span>Importar anotaciones</span><strong>JSON existente</strong><input data-annotation-import type="file" accept=".json,application/json"></label>
        </div>

        <div class="annotation-workspace">
          <div class="annotation-stage-wrap">
            <div class="annotation-stage">
              <video data-annotation-player controls muted playsinline preload="metadata"></video>
              <canvas data-annotation-canvas></canvas>
              ${this.videoFile ? '' : '<div class="annotation-placeholder">El video permanece local en este navegador.</div>'}
            </div>
            <div class="annotation-stage-toolbar">
              <button class="action primary" data-capture-frame type="button" ${this.videoFile ? '' : 'disabled'}>Capturar frame visible</button>
              <button class="action secondary" data-prev-frame type="button" ${activeIndex > 0 ? '' : 'disabled'}>← Frame anterior</button>
              <button class="action secondary" data-next-frame type="button" ${activeIndex >= 0 && activeIndex < this.draft.frames.length - 1 ? '' : 'disabled'}>Frame siguiente →</button>
              <button class="action secondary" data-remove-frame type="button" ${frame ? '' : 'disabled'}>Eliminar frame</button>
            </div>
            <p class="runtime-note">Para anotar: pausa el video, captura el frame visible y arrastra sobre la imagen. El JSON guarda <code>bbox</code> en píxeles fuente, no en píxeles CSS. <code>timestampMs</code> se inicializa igual a <code>mediaTimeMs</code>, manteniéndose como campos semánticamente distintos.</p>
          </div>

          <aside class="annotation-sidebar">
            <div class="annotation-frame-summary">
              <span>Frame activo</span>
              <strong>${frame ? html(frame.frameId) : '—'}</strong>
              <small>${frame ? `${formatTime(frame.mediaTimeMs)} · ${frame.width}×${frame.height} · ${frame.objects.length} objetos` : `${this.draft.frames.length} frames capturados`}</small>
            </div>

            <div class="annotation-object-controls">
              <label><span>Clase</span><select data-annotation-class>${DETECTOR_GROUND_TRUTH_CLASSES.map((value) => `<option value="${value}" ${value === this.className ? 'selected' : ''}>${value}</option>`).join('')}</select></label>
              <label><span>Oclusión</span><select data-annotation-occlusion>${(['none', 'partial', 'heavy'] as const).map((value) => `<option value="${value}" ${value === this.occlusion ? 'selected' : ''}>${value}</option>`).join('')}</select></label>
              <label class="annotation-checkbox"><input data-annotation-ignore type="checkbox" ${this.ignore ? 'checked' : ''}><span>ignore</span></label>
            </div>

            <div class="annotation-object-list">
              ${frame?.objects.length
                ? frame.objects.map((object) => this.objectRow(object)).join('')
                : '<p>No hay objetos en este frame.</p>'}
            </div>

            <div class="annotation-export">
              <strong>${this.draft.frames.length} frames · ${this.draft.frames.reduce((sum, value) => sum + value.objects.length, 0)} objetos</strong>
              <button class="action primary" data-export-annotations type="button" ${this.draft.frames.length > 0 ? '' : 'disabled'}>Guardar anotaciones JSON</button>
            </div>
          </aside>
        </div>

        <div class="benchmark-progress annotation-message">${html(this.message)}</div>
        ${this.error ? `<div class="runtime-error">${html(this.error)}</div>` : ''}
      </section>
    `;

    this.attachEvents();
    this.configureVideoAfterRender();
    this.drawOverlay();
  }

  private objectRow(object: GroundTruthObject): string {
    const selected = object.annotationId === this.selectedAnnotationId;
    const box = object.bbox;
    return `
      <button type="button" class="annotation-object-row ${selected ? 'selected' : ''}" data-select-object="${html(object.annotationId)}">
        <strong>${html(object.className)}</strong>
        <span>${html(object.annotationId)}</span>
        <small>x ${box.x.toFixed(0)} · y ${box.y.toFixed(0)} · ${box.width.toFixed(0)}×${box.height.toFixed(0)} · ${object.occlusion ?? 'none'}${object.ignore ? ' · ignore' : ''}</small>
      </button>
    `;
  }

  private attachEvents(): void {
    const mount = this.mountElement;
    if (!mount) return;
    mount.querySelector<HTMLInputElement>('[data-annotation-dataset]')?.addEventListener('change', (event) => {
      const value = (event.currentTarget as HTMLInputElement).value.trim();
      if (value) this.draft.datasetId = value;
      this.render();
    });
    mount.querySelector<HTMLInputElement>('[data-annotation-sequence]')?.addEventListener('change', (event) => {
      const value = (event.currentTarget as HTMLInputElement).value.trim();
      if (value) this.draft.sequenceId = value;
      this.render();
    });
    mount.querySelector<HTMLInputElement>('[data-annotation-video]')?.addEventListener('change', (event) => {
      void this.loadVideo((event.currentTarget as HTMLInputElement).files?.[0] ?? null);
    });
    mount.querySelector<HTMLInputElement>('[data-annotation-import]')?.addEventListener('change', (event) => {
      void this.importAnnotations((event.currentTarget as HTMLInputElement).files?.[0] ?? null);
    });
    mount.querySelector<HTMLSelectElement>('[data-annotation-class]')?.addEventListener('change', (event) => {
      this.className = (event.currentTarget as HTMLSelectElement).value as DetectorGroundTruthClass;
    });
    mount.querySelector<HTMLSelectElement>('[data-annotation-occlusion]')?.addEventListener('change', (event) => {
      this.occlusion = (event.currentTarget as HTMLSelectElement).value as GroundTruthOcclusion;
    });
    mount.querySelector<HTMLInputElement>('[data-annotation-ignore]')?.addEventListener('change', (event) => {
      this.ignore = (event.currentTarget as HTMLInputElement).checked;
    });
    mount.querySelector<HTMLButtonElement>('[data-capture-frame]')?.addEventListener('click', () => void this.captureFrame());
    mount.querySelector<HTMLButtonElement>('[data-prev-frame]')?.addEventListener('click', () => void this.navigateFrame(-1));
    mount.querySelector<HTMLButtonElement>('[data-next-frame]')?.addEventListener('click', () => void this.navigateFrame(1));
    mount.querySelector<HTMLButtonElement>('[data-remove-frame]')?.addEventListener('click', () => this.removeFrame());
    mount.querySelector<HTMLButtonElement>('[data-export-annotations]')?.addEventListener('click', () => this.exportAnnotations());
    for (const button of mount.querySelectorAll<HTMLButtonElement>('[data-select-object]')) {
      button.addEventListener('click', () => {
        const id = button.dataset.selectObject;
        this.selectedAnnotationId = id === this.selectedAnnotationId ? null : id ?? null;
        this.render();
      });
    }

    const canvas = mount.querySelector<HTMLCanvasElement>('[data-annotation-canvas]');
    canvas?.addEventListener('pointerdown', (event) => this.pointerDown(event));
    canvas?.addEventListener('pointermove', (event) => this.pointerMove(event));
    canvas?.addEventListener('pointerup', (event) => this.pointerUp(event));
    canvas?.addEventListener('pointercancel', () => {
      this.drawing = null;
      this.drawOverlay();
    });
    window.addEventListener('keydown', this.handleKeyDown, { once: true });
  }

  private configureVideoAfterRender(): void {
    const video = this.mountElement?.querySelector<HTMLVideoElement>('[data-annotation-player]');
    if (!video || !this.videoUrl) return;
    video.src = this.videoUrl;
    const frame = this.activeFrame();
    if (frame?.mediaTimeMs !== undefined) video.currentTime = frame.mediaTimeMs / 1000;
    video.addEventListener('loadedmetadata', () => this.configureCanvas(video), { once: true });
    video.addEventListener('seeked', () => this.drawOverlay());
    video.addEventListener('loadeddata', () => this.drawOverlay(), { once: true });
  }

  private configureCanvas(video: HTMLVideoElement): void {
    const canvas = this.mountElement?.querySelector<HTMLCanvasElement>('[data-annotation-canvas]');
    if (!canvas || video.videoWidth <= 0 || video.videoHeight <= 0) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    this.drawOverlay();
  }

  private async loadVideo(file: File | null): Promise<void> {
    this.revokeVideoUrl();
    this.videoFile = file;
    this.error = null;
    if (!file) {
      this.message = 'Video removido. Las anotaciones permanecen en memoria local.';
      this.render();
      return;
    }
    this.videoUrl = URL.createObjectURL(file);
    this.message = `${file.name} cargado localmente. Busca una escena representativa y captura el frame.`;
    this.render();
  }

  private async importAnnotations(file: File | null): Promise<void> {
    if (!file) return;
    try {
      const sequence = parseAnnotatedBenchmarkSequenceJson(await file.text());
      this.draft = restoreAnnotationDraft(sequence);
      this.activeFrameId = this.draft.frames[0]?.frameId ?? null;
      this.selectedAnnotationId = null;
      this.error = null;
      this.message = `${file.name} importado · ${this.draft.frames.length} frames.`;
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'annotation_import_failed';
      this.message = 'El archivo de anotaciones fue rechazado.';
    }
    this.render();
  }

  private async captureFrame(): Promise<void> {
    const video = this.mountElement?.querySelector<HTMLVideoElement>('[data-annotation-player]');
    if (!video || !this.videoFile) return;
    if (video.videoWidth <= 0 || video.videoHeight <= 0) {
      this.error = 'El video aún no tiene metadata de dimensiones disponible.';
      this.render();
      return;
    }
    video.pause();
    const mediaTimeMs = await presentedMediaTimeMs(video);
    const frame = addAnnotationFrame(this.draft, {
      mediaTimeMs,
      width: video.videoWidth,
      height: video.videoHeight,
    });
    this.activeFrameId = frame.frameId;
    this.selectedAnnotationId = null;
    this.error = null;
    this.message = `${frame.frameId} capturado en ${formatTime(frame.mediaTimeMs)}. Arrastra sobre la imagen para crear cajas.`;
    this.render();
  }

  private async navigateFrame(delta: number): Promise<void> {
    const frame = this.activeFrame();
    if (!frame) return;
    const index = this.draft.frames.findIndex((value) => value.frameId === frame.frameId);
    const target = this.draft.frames[index + delta];
    if (!target) return;
    this.activeFrameId = target.frameId;
    this.selectedAnnotationId = null;
    this.render();
    const video = this.mountElement?.querySelector<HTMLVideoElement>('[data-annotation-player]');
    if (video && target.mediaTimeMs !== undefined) {
      try {
        await waitForSeek(video, target.mediaTimeMs / 1000);
        this.drawOverlay();
      } catch (error) {
        this.error = error instanceof Error ? error.message : 'annotation_seek_failed';
        this.render();
      }
    }
  }

  private removeFrame(): void {
    const frame = this.activeFrame();
    if (!frame) return;
    const index = this.draft.frames.findIndex((value) => value.frameId === frame.frameId);
    removeAnnotationFrame(this.draft, frame.frameId);
    this.activeFrameId = this.draft.frames[Math.min(index, this.draft.frames.length - 1)]?.frameId ?? null;
    this.selectedAnnotationId = null;
    this.message = `${frame.frameId} eliminado.`;
    this.render();
  }

  private pointerPosition(event: PointerEvent, canvas: HTMLCanvasElement): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(canvas.width, (event.clientX - rect.left) * canvas.width / rect.width)),
      y: Math.max(0, Math.min(canvas.height, (event.clientY - rect.top) * canvas.height / rect.height)),
    };
  }

  private pointerDown(event: PointerEvent): void {
    const canvas = event.currentTarget as HTMLCanvasElement;
    if (!this.activeFrame() || canvas.width <= 0 || canvas.height <= 0) return;
    const point = this.pointerPosition(event, canvas);
    this.drawing = { startX: point.x, startY: point.y, endX: point.x, endY: point.y };
    canvas.setPointerCapture(event.pointerId);
  }

  private pointerMove(event: PointerEvent): void {
    if (!this.drawing) return;
    const canvas = event.currentTarget as HTMLCanvasElement;
    const point = this.pointerPosition(event, canvas);
    this.drawing.endX = point.x;
    this.drawing.endY = point.y;
    this.drawOverlay();
  }

  private pointerUp(event: PointerEvent): void {
    const drawing = this.drawing;
    const frame = this.activeFrame();
    const canvas = event.currentTarget as HTMLCanvasElement;
    if (!drawing || !frame) return;
    const point = this.pointerPosition(event, canvas);
    drawing.endX = point.x;
    drawing.endY = point.y;
    this.drawing = null;
    const x = Math.min(drawing.startX, drawing.endX);
    const y = Math.min(drawing.startY, drawing.endY);
    const width = Math.abs(drawing.endX - drawing.startX);
    const height = Math.abs(drawing.endY - drawing.startY);
    if (width < 3 || height < 3) {
      this.message = 'Caja descartada: arrastre demasiado pequeño.';
      this.drawOverlay();
      return;
    }
    try {
      const object = addGroundTruthObject(this.draft, frame.frameId, {
        className: this.className,
        bbox: { x, y, width, height },
        occlusion: this.occlusion,
        ignore: this.ignore,
      });
      this.selectedAnnotationId = object.annotationId;
      this.message = `${object.annotationId} · ${object.className} agregado.`;
      this.error = null;
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'annotation_box_failed';
    }
    this.render();
  }

  private drawOverlay(): void {
    const canvas = this.mountElement?.querySelector<HTMLCanvasElement>('[data-annotation-canvas]');
    if (!canvas || canvas.width <= 0 || canvas.height <= 0) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    const frame = this.activeFrame();
    if (frame) {
      context.lineWidth = Math.max(2, canvas.width / 700);
      context.font = `${Math.max(14, canvas.width / 55)}px system-ui`;
      for (const object of frame.objects) {
        const selected = object.annotationId === this.selectedAnnotationId;
        context.strokeStyle = selected ? '#fef08a' : object.ignore ? '#94a3b8' : '#5eead4';
        context.fillStyle = context.strokeStyle;
        if (object.ignore) context.setLineDash([10, 8]);
        else context.setLineDash([]);
        context.strokeRect(object.bbox.x, object.bbox.y, object.bbox.width, object.bbox.height);
        context.fillText(`${object.className}${object.ignore ? ' · ignore' : ''}`, object.bbox.x + 4, Math.max(18, object.bbox.y - 5));
      }
    }
    if (this.drawing) {
      context.setLineDash([8, 6]);
      context.strokeStyle = '#f8fafc';
      context.lineWidth = Math.max(2, canvas.width / 700);
      context.strokeRect(
        this.drawing.startX,
        this.drawing.startY,
        this.drawing.endX - this.drawing.startX,
        this.drawing.endY - this.drawing.startY,
      );
    }
    context.setLineDash([]);
  }

  private exportAnnotations(): void {
    try {
      const text = serializeAnnotationDraft(this.draft);
      downloadText(`${safeFilePart(this.draft.datasetId)}-${safeFilePart(this.draft.sequenceId)}.json`, text);
      this.error = null;
      this.message = 'Anotaciones validadas y exportadas. El benchmark calculará el SHA-256 del archivo real al ejecutarlo.';
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'annotation_export_failed';
      this.message = 'No se exportó: el corpus no supera la validación estructural.';
    }
    this.render();
  }

  private handleKeyDown = (event: KeyboardEvent): void => {
    if (this.destroyed) return;
    if (event.key !== 'Delete' && event.key !== 'Backspace') return;
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) return;
    const frame = this.activeFrame();
    if (!frame || !this.selectedAnnotationId) return;
    if (removeGroundTruthObject(this.draft, frame.frameId, this.selectedAnnotationId)) {
      this.message = `${this.selectedAnnotationId} eliminado.`;
      this.selectedAnnotationId = null;
      this.render();
    }
  };

  private revokeVideoUrl(): void {
    if (!this.videoUrl) return;
    URL.revokeObjectURL(this.videoUrl);
    this.videoUrl = null;
  }
}
