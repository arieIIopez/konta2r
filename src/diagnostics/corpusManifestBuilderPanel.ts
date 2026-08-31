import {
  CORPUS_DEVICE_PROFILES,
  CORPUS_LIGHTING,
  CORPUS_SCENE_TYPES,
  CORPUS_SPLITS,
  CORPUS_VIEW_ANGLES,
  summarizeCorpusManifestCoverage,
  type CorpusDeviceProfile,
  type CorpusLighting,
  type CorpusManifestSequence,
  type CorpusSceneType,
  type CorpusSplit,
  type CorpusViewAngle,
} from '../detection/corpusManifest';
import {
  createCorpusManifest,
  prepareLocalCorpusManifestSequence,
  serializeCorpusManifest,
} from '../detection/localCorpusManifestBuilder';

function html(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function optionList(values: readonly string[], selected: string): string {
  return values.map((value) => `<option value="${html(value)}" ${value === selected ? 'selected' : ''}>${html(value)}</option>`).join('');
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

function safeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'corpus';
}

export class CorpusManifestBuilderPanel {
  private mountElement: HTMLElement | null = null;
  private sequences: CorpusManifestSequence[] = [];
  private corpusId = 'konta2r-pilot-001';
  private split: CorpusSplit = 'development';
  private siteId = 'site-001';
  private sceneType: CorpusSceneType = 'mixed_traffic';
  private lighting: CorpusLighting = 'day';
  private viewAngle: CorpusViewAngle = 'medium_oblique';
  private deviceProfile: CorpusDeviceProfile = 'unknown';
  private annotationFile: File | null = null;
  private mediaFile: File | null = null;
  private progress = '';
  private message = 'Selecciona anotaciones y, para secuencias de video, su medio local correspondiente.';
  private error: string | null = null;
  private busy = false;

  mount(element: HTMLElement): void {
    this.mountElement = element;
    this.render();
  }

  destroy(): void {
    this.mountElement?.replaceChildren();
    this.mountElement = null;
  }

  private render(): void {
    const mount = this.mountElement;
    if (!mount) return;
    const coverage = this.sequences.length > 0
      ? summarizeCorpusManifestCoverage(createCorpusManifest(this.corpusId, this.sequences, new Date().toISOString()))
      : null;

    mount.innerHTML = `
      <section class="node-runtime-shell corpus-shell">
        <header class="node-runtime-head">
          <div>
            <div class="eyebrow">Builder local</div>
            <h2>Construir manifest multi-secuencia</h2>
            <p>Calcula hashes sobre archivos locales y agrega secuencias al manifest sin escribir JSON ni duplicar manualmente el <code>sequenceId</code>.</p>
          </div>
          <a class="probe-back" href="./?diagnostics=manifest">Revisar manifest</a>
        </header>

        <div class="corpus-input-card manifest-builder-form">
          <label><span>Corpus ID</span><input data-builder-corpus value="${html(this.corpusId)}" ${this.busy ? 'disabled' : ''}></label>
          <label><span>Split</span><select data-builder-split ${this.busy ? 'disabled' : ''}>${optionList(CORPUS_SPLITS, this.split)}</select></label>
          <label><span>Site ID opaco</span><input data-builder-site value="${html(this.siteId)}" ${this.busy ? 'disabled' : ''}></label>
          <label><span>Escena</span><select data-builder-scene ${this.busy ? 'disabled' : ''}>${optionList(CORPUS_SCENE_TYPES, this.sceneType)}</select></label>
          <label><span>Iluminación</span><select data-builder-lighting ${this.busy ? 'disabled' : ''}>${optionList(CORPUS_LIGHTING, this.lighting)}</select></label>
          <label><span>Ángulo</span><select data-builder-angle ${this.busy ? 'disabled' : ''}>${optionList(CORPUS_VIEW_ANGLES, this.viewAngle)}</select></label>
          <label><span>Perfil dispositivo</span><select data-builder-device ${this.busy ? 'disabled' : ''}>${optionList(CORPUS_DEVICE_PROFILES, this.deviceProfile)}</select></label>
          <label><span>Anotaciones JSON</span><strong>${this.annotationFile ? html(this.annotationFile.name) : 'Seleccionar'}</strong><input data-builder-annotations type="file" accept=".json,application/json" ${this.busy ? 'disabled' : ''}></label>
          <label><span>Video/medio local</span><strong>${this.mediaFile ? html(this.mediaFile.name) : 'Opcional si las anotaciones no declaran mediaSha256'}</strong><input data-builder-media type="file" accept="video/*,image/*" ${this.busy ? 'disabled' : ''}></label>
          <button class="action primary" data-builder-add type="button" ${!this.annotationFile || this.busy ? 'disabled' : ''}>${this.busy ? 'Calculando hashes…' : 'Agregar secuencia verificada'}</button>
          ${this.progress ? `<p class="corpus-empty">${html(this.progress)}</p>` : ''}
        </div>

        ${this.sequences.length > 0 ? `
          <section class="corpus-card corpus-builder-list">
            <h3>Secuencias preparadas</h3>
            ${this.sequences.map((sequence, index) => `
              <div class="corpus-count-row corpus-builder-sequence">
                <span><strong>${html(sequence.sequenceId)}</strong><br>${html(sequence.split)} · ${html(sequence.siteId)} · ${html(sequence.sceneType)}</span>
                <button class="action secondary" type="button" data-builder-remove="${index}" ${this.busy ? 'disabled' : ''}>Quitar</button>
              </div>
            `).join('')}
          </section>

          <div class="corpus-kpis">
            <div><span>Secuencias</span><strong>${coverage?.sequenceCount ?? 0}</strong></div>
            <div><span>Sitios</span><strong>${coverage?.siteCount ?? 0}</strong></div>
            <div><span>Development</span><strong>${coverage?.splitCounts.development ?? 0}</strong></div>
            <div><span>Validation</span><strong>${coverage?.splitCounts.validation ?? 0}</strong></div>
            <div><span>Held-out</span><strong>${coverage?.splitCounts.held_out_test ?? 0}</strong></div>
          </div>

          <div class="annotation-stage-toolbar corpus-builder-export">
            <button class="action primary" data-builder-export type="button" ${this.busy ? 'disabled' : ''}>Guardar manifest JSON</button>
          </div>
        ` : ''}

        <div class="benchmark-progress annotation-message">${html(this.message)}</div>
        ${this.error ? `<div class="runtime-error">${html(this.error)}</div>` : ''}
      </section>
    `;

    this.attachEvents();
  }

  private attachEvents(): void {
    const mount = this.mountElement;
    if (!mount) return;
    mount.querySelector<HTMLInputElement>('[data-builder-corpus]')?.addEventListener('input', (event) => {
      this.corpusId = (event.currentTarget as HTMLInputElement).value;
    });
    mount.querySelector<HTMLSelectElement>('[data-builder-split]')?.addEventListener('change', (event) => {
      this.split = (event.currentTarget as HTMLSelectElement).value as CorpusSplit;
    });
    mount.querySelector<HTMLInputElement>('[data-builder-site]')?.addEventListener('input', (event) => {
      this.siteId = (event.currentTarget as HTMLInputElement).value;
    });
    mount.querySelector<HTMLSelectElement>('[data-builder-scene]')?.addEventListener('change', (event) => {
      this.sceneType = (event.currentTarget as HTMLSelectElement).value as CorpusSceneType;
    });
    mount.querySelector<HTMLSelectElement>('[data-builder-lighting]')?.addEventListener('change', (event) => {
      this.lighting = (event.currentTarget as HTMLSelectElement).value as CorpusLighting;
    });
    mount.querySelector<HTMLSelectElement>('[data-builder-angle]')?.addEventListener('change', (event) => {
      this.viewAngle = (event.currentTarget as HTMLSelectElement).value as CorpusViewAngle;
    });
    mount.querySelector<HTMLSelectElement>('[data-builder-device]')?.addEventListener('change', (event) => {
      this.deviceProfile = (event.currentTarget as HTMLSelectElement).value as CorpusDeviceProfile;
    });
    mount.querySelector<HTMLInputElement>('[data-builder-annotations]')?.addEventListener('change', (event) => {
      this.annotationFile = (event.currentTarget as HTMLInputElement).files?.[0] ?? null;
      this.error = null;
      this.render();
    });
    mount.querySelector<HTMLInputElement>('[data-builder-media]')?.addEventListener('change', (event) => {
      this.mediaFile = (event.currentTarget as HTMLInputElement).files?.[0] ?? null;
      this.error = null;
      this.render();
    });
    mount.querySelector<HTMLButtonElement>('[data-builder-add]')?.addEventListener('click', () => void this.addSequence());
    mount.querySelector<HTMLButtonElement>('[data-builder-export]')?.addEventListener('click', () => this.exportManifest());
    for (const button of mount.querySelectorAll<HTMLButtonElement>('[data-builder-remove]')) {
      button.addEventListener('click', () => {
        const index = Number(button.dataset.builderRemove);
        if (Number.isInteger(index) && index >= 0 && index < this.sequences.length) {
          this.sequences.splice(index, 1);
          this.message = 'Secuencia removida del borrador local.';
          this.error = null;
          this.render();
        }
      });
    }
  }

  private async addSequence(): Promise<void> {
    const annotationFile = this.annotationFile;
    if (!annotationFile || this.busy) return;
    this.busy = true;
    this.error = null;
    this.progress = 'Preparando anotaciones…';
    this.render();
    try {
      const prepared = await prepareLocalCorpusManifestSequence(
        {
          annotationBlob: annotationFile,
          ...(this.mediaFile === null ? {} : { mediaBlob: this.mediaFile }),
        },
        {
          split: this.split,
          siteId: this.siteId,
          sceneType: this.sceneType,
          lighting: this.lighting,
          viewAngle: this.viewAngle,
          deviceProfile: this.deviceProfile,
        },
        {
          onProgress: (value) => {
            const percent = value.totalBytes <= 0 ? 0 : (value.processedBytes / value.totalBytes) * 100;
            this.progress = `${value.phase === 'annotation' ? 'Anotaciones' : 'Medio'} · ${percent.toFixed(0)}%`;
          },
        },
      );
      const candidate = [...this.sequences, prepared];
      createCorpusManifest(this.corpusId, candidate);
      this.sequences = candidate;
      this.annotationFile = null;
      this.mediaFile = null;
      this.message = `${prepared.sequenceId} agregado con hashes calculados sobre bytes locales.`;
      this.progress = '';
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'manifest_builder_failed';
      this.message = 'La secuencia no fue agregada.';
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private exportManifest(): void {
    try {
      const manifest = createCorpusManifest(this.corpusId, this.sequences);
      downloadText(`${safeFilePart(this.corpusId)}-manifest.json`, serializeCorpusManifest(manifest));
      this.error = null;
      this.message = 'Manifest validado y exportado localmente. Congela este archivo antes de la evaluación held-out final.';
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'manifest_export_failed';
      this.message = 'El manifest no fue exportado.';
    }
    this.render();
  }
}
