import './countingGeometry.css';
import { CountingGeometryEditor, type CountingGeometryEditorSnapshot } from './countingGeometryEditor';
import { IndexedDbCountingGeometryStore } from './indexedDbCountingGeometry';

function setText(root: HTMLElement, selector: string, value: string): void {
  const element = root.querySelector<HTMLElement>(selector);
  if (element) element.textContent = value;
}

export class CountingGeometryPanel {
  private readonly editor = new CountingGeometryEditor({
    store: new IndexedDbCountingGeometryStore(),
    lineId: 'line_primary',
  });
  private root: HTMLElement | null = null;
  private controls: HTMLElement | null = null;
  private unsubscribe: (() => void) | null = null;

  mount(nodeRoot: HTMLElement): void {
    this.destroy();
    const video = nodeRoot.querySelector<HTMLVideoElement>('#node-camera');
    const cameraWrap = nodeRoot.querySelector<HTMLElement>('.node-camera-wrap');
    const runtimeControls = nodeRoot.querySelector<HTMLElement>('.node-runtime-controls');
    if (!video || !cameraWrap || !runtimeControls) {
      throw new Error('Counting geometry requires the mounted node camera UI');
    }
    this.root = nodeRoot;
    const controls = document.createElement('section');
    controls.className = 'counting-geometry-panel';
    controls.innerHTML = `
      <div class="counting-geometry-head">
        <div>
          <span>Línea de conteo</span>
          <strong data-geometry-title>Sin geometría</strong>
          <small data-geometry-detail>Dibuja una línea orientada sobre la cámara antes de habilitar conteos.</small>
        </div>
        <span class="status-pill" data-geometry-status>○ no configurada</span>
      </div>
      <div class="counting-geometry-actions">
        <button class="action" type="button" data-geometry-edit>Definir línea</button>
        <button class="action primary" type="button" data-geometry-save>Guardar</button>
        <button class="action" type="button" data-geometry-cancel>Cancelar</button>
        <button class="action danger" type="button" data-geometry-clear>Borrar línea</button>
      </div>
      <p class="counting-geometry-help">Arrastra sobre la imagen desde un extremo al otro. La flecha fija la orientación de referencia; <strong>A</strong> y <strong>B</strong> son los dos lados de cruce. Los conteos A→B y B→A son transversales a la línea, no movimientos a lo largo de ella.</p>
      <p class="counting-geometry-error hidden" data-geometry-error></p>
    `;
    runtimeControls.insertAdjacentElement('afterend', controls);
    this.controls = controls;
    this.editor.mount(cameraWrap, video);

    controls.querySelector<HTMLButtonElement>('[data-geometry-edit]')?.addEventListener('click', () => {
      this.editor.setEditing(true);
    });
    controls.querySelector<HTMLButtonElement>('[data-geometry-cancel]')?.addEventListener('click', () => {
      this.editor.cancelEditing();
    });
    controls.querySelector<HTMLButtonElement>('[data-geometry-save]')?.addEventListener('click', () => {
      void this.editor.save().catch(() => undefined);
    });
    controls.querySelector<HTMLButtonElement>('[data-geometry-clear]')?.addEventListener('click', () => {
      void this.editor.clear();
    });

    this.unsubscribe = this.editor.subscribe((snapshot) => this.render(snapshot));
    void this.editor.load();
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.editor.destroy();
    this.controls?.remove();
    this.controls = null;
    this.root = null;
  }

  private render(snapshot: CountingGeometryEditorSnapshot): void {
    const controls = this.controls;
    if (!controls) return;
    const configuration = snapshot.configuration;
    const line = snapshot.draft ?? configuration?.line;
    const revision = configuration?.revision;
    const status = controls.querySelector<HTMLElement>('[data-geometry-status]');

    if (!snapshot.loaded) {
      setText(controls, '[data-geometry-title]', 'Cargando…');
      setText(controls, '[data-geometry-detail]', 'Leyendo configuración local.');
      if (status) status.textContent = '○ cargando';
    } else if (snapshot.editing) {
      setText(controls, '[data-geometry-title]', snapshot.dirty ? 'Línea en edición' : 'Editando línea');
      setText(controls, '[data-geometry-detail]', line
        ? `A (${line.a.x.toFixed(3)}, ${line.a.y.toFixed(3)}) · B (${line.b.x.toFixed(3)}, ${line.b.y.toFixed(3)})`
        : 'Arrastra sobre la cámara para definir la línea.');
      if (status) status.textContent = '● edición';
    } else if (configuration) {
      setText(controls, '[data-geometry-title]', `Geometría ${configuration.configurationId.slice(-8)}`);
      setText(controls, '[data-geometry-detail]', `revisión ${revision ?? '—'} · referencia ${Math.round(configuration.referenceFrame.width)}×${Math.round(configuration.referenceFrame.height)} · guardada ${new Date(configuration.updatedAtIso).toLocaleString()}`);
      if (status) {
        status.textContent = '● configurada';
        status.classList.add('runtime-on');
      }
    } else {
      setText(controls, '[data-geometry-title]', 'Sin geometría');
      setText(controls, '[data-geometry-detail]', 'No existe una línea persistida. Community no debe publicar conteos de flujo sin esta configuración.');
      if (status) {
        status.textContent = '○ no configurada';
        status.classList.remove('runtime-on');
      }
    }

    const edit = controls.querySelector<HTMLButtonElement>('[data-geometry-edit]');
    const save = controls.querySelector<HTMLButtonElement>('[data-geometry-save]');
    const cancel = controls.querySelector<HTMLButtonElement>('[data-geometry-cancel]');
    const clear = controls.querySelector<HTMLButtonElement>('[data-geometry-clear]');
    if (edit) edit.disabled = snapshot.editing || !snapshot.loaded;
    if (save) save.disabled = !snapshot.editing || !snapshot.dirty || !snapshot.draft;
    if (cancel) cancel.disabled = !snapshot.editing;
    if (clear) clear.disabled = snapshot.editing || !configuration;

    const error = controls.querySelector<HTMLElement>('[data-geometry-error]');
    if (error) {
      error.textContent = snapshot.error ?? '';
      error.classList.toggle('hidden', snapshot.error === undefined);
    }
  }
}
