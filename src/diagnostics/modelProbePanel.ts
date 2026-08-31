import { KALRAY_SSD_MOBILENET_V2_COCO, type DetectorCandidateRecord } from '../detection/modelCandidates';
import { fetchVerifiedOnnxArtifact } from '../detection/onnx/modelArtifact';
import { probeOnnxModel, type OnnxModelProbeResult } from '../detection/onnx/modelProbe';

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatMetadata(result: OnnxModelProbeResult): string {
  return JSON.stringify({
    runtime: result.runtime,
    webgpuAttempted: result.webgpuAttempted,
    ...(result.fallbackReason === undefined ? {} : { fallbackReason: result.fallbackReason }),
    inputs: result.inputs,
    outputs: result.outputs,
  }, null, 2);
}

/**
 * Developer/field-diagnostics surface. It never auto-fetches a checkpoint: the
 * user must explicitly start the potentially large external download.
 */
export class ModelProbePanel {
  private mountElement: HTMLElement | null = null;
  private running = false;
  private destroyed = false;
  private candidate: DetectorCandidateRecord = KALRAY_SSD_MOBILENET_V2_COCO;

  mount(element: HTMLElement): void {
    this.mountElement = element;
    this.render();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.mountElement) this.mountElement.replaceChildren();
    this.mountElement = null;
  }

  private render(): void {
    const mount = this.mountElement;
    if (!mount || this.destroyed) return;
    const candidate = this.candidate;
    mount.innerHTML = `
      <section class="node-runtime-shell probe-shell">
        <header class="node-runtime-head">
          <div>
            <div class="eyebrow">Diagnóstico ONNX</div>
            <h2>Inspección reproducible del checkpoint</h2>
            <p>Descarga bajo demanda, verifica SHA-256 y lee el contrato IO declarado por ONNX Runtime. No ejecuta inferencia ni almacena el modelo en Konta2r.</p>
          </div>
          <a class="probe-back" href="./">Volver al nodo</a>
        </header>
        <div class="probe-card">
          <dl class="probe-facts">
            <div><dt>Candidato</dt><dd>${candidate.displayName}</dd></div>
            <div><dt>Rol</dt><dd>${candidate.role}</dd></div>
            <div><dt>Estado</dt><dd>${candidate.status}</dd></div>
            <div><dt>Dataset</dt><dd>${candidate.dataset}</dd></div>
            <div><dt>Input esperado</dt><dd>${candidate.inputHint ? `${candidate.inputHint.width}×${candidate.inputHint.height} ${candidate.inputHint.layout}` : 'sin hipótesis'}</dd></div>
            <div><dt>Tamaño publicado</dt><dd>${candidate.artifact.approximateSizeMb ?? '?'} MB</dd></div>
            <div><dt>Licencia declarada</dt><dd>${candidate.artifact.declaredLicense}</dd></div>
            <div><dt>Redistribución verificada</dt><dd>${candidate.artifact.redistributionVerified ? 'sí' : 'no'}</dd></div>
          </dl>
          <p class="runtime-note">Esta prueba descargará aproximadamente ${candidate.artifact.approximateSizeMb ?? 67} MB desde la fuente externa. El archivo no se entrega a ONNX Runtime si su SHA-256 difiere del registro.</p>
          <div class="node-runtime-controls">
            <button class="action" type="button" data-probe-start ${this.running ? 'disabled' : ''}>${this.running ? 'Inspeccionando…' : 'Verificar e inspeccionar modelo'}</button>
          </div>
          <div class="runtime-error hidden" data-probe-error></div>
          <div class="probe-progress hidden" data-probe-progress></div>
          <pre class="probe-output hidden" data-probe-output></pre>
        </div>
      </section>
    `;

    mount.querySelector<HTMLButtonElement>('[data-probe-start]')?.addEventListener('click', () => {
      void this.runProbe();
    });
  }

  private async runProbe(): Promise<void> {
    if (this.running || this.destroyed) return;
    this.running = true;
    this.render();
    const mount = this.mountElement;
    const progress = mount?.querySelector<HTMLElement>('[data-probe-progress]');
    const errorBox = mount?.querySelector<HTMLElement>('[data-probe-error]');
    const output = mount?.querySelector<HTMLElement>('[data-probe-output]');

    try {
      if (progress) {
        progress.classList.remove('hidden');
        progress.textContent = 'Descargando y verificando SHA-256…';
      }
      const artifact = await fetchVerifiedOnnxArtifact(
        this.candidate.artifact.url,
        this.candidate.artifact.sha256,
      );
      if (this.destroyed) return;

      if (progress) progress.textContent = `Checkpoint verificado (${formatMb(artifact.sizeBytes)}). Creando sesión temporal…`;
      const result = await probeOnnxModel(artifact.bytes);
      if (this.destroyed) return;

      if (progress) progress.textContent = `Verificación completa · SHA-256 ${artifact.sha256}`;
      if (output) {
        output.classList.remove('hidden');
        output.textContent = formatMetadata(result);
      }
    } catch (error) {
      if (this.destroyed) return;
      if (progress) progress.classList.add('hidden');
      if (errorBox) {
        errorBox.classList.remove('hidden');
        errorBox.textContent = error instanceof Error ? error.message : 'model_probe_failed';
      }
    } finally {
      this.running = false;
      const button = this.mountElement?.querySelector<HTMLButtonElement>('[data-probe-start]');
      if (button) {
        button.disabled = false;
        button.textContent = 'Verificar e inspeccionar nuevamente';
      }
    }
  }
}
