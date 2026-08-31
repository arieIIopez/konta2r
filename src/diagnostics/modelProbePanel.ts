import {
  DETECTOR_CANDIDATES,
  KALRAY_SSD_MOBILENET_V2_COCO,
  type DetectorCandidateRecord,
} from '../detection/modelCandidates';
import { assessCandidateProbeCompatibility } from '../detection/onnx/candidateProbeCompatibility';
import { fetchVerifiedOnnxArtifact } from '../detection/onnx/modelArtifact';
import { probeOnnxModel } from '../detection/onnx/modelProbe';
import {
  buildOnnxCandidateProbeDiagnosticRecord,
  serializeOnnxCandidateProbeDiagnosticRecord,
  type OnnxCandidateProbeDiagnosticRecord,
} from '../detection/onnx/probeDiagnostic';
import { buildOnnxProbeRecord } from '../detection/onnx/probeRecord';

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function safeFileTimestamp(iso: string): string {
  return iso.replace(/[:.]/g, '-');
}

/**
 * Developer/field-diagnostics surface. It never auto-fetches a checkpoint: the
 * user must explicitly select and start the potentially large external download.
 */
export class ModelProbePanel {
  private mountElement: HTMLElement | null = null;
  private running = false;
  private destroyed = false;
  private lastDiagnostic: OnnxCandidateProbeDiagnosticRecord | null = null;
  private candidate: DetectorCandidateRecord = KALRAY_SSD_MOBILENET_V2_COCO;

  mount(element: HTMLElement): void {
    this.mountElement = element;
    this.render();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.mountElement) this.mountElement.replaceChildren();
    this.mountElement = null;
    this.lastDiagnostic = null;
  }

  private render(): void {
    const mount = this.mountElement;
    if (!mount || this.destroyed) return;
    const candidate = this.candidate;
    const diagnostic = this.lastDiagnostic;
    const record = diagnostic?.probe;
    const compatibility = diagnostic?.codecCompatibility;
    const options = DETECTOR_CANDIDATES
      .map((value) => `<option value="${this.escapeHtml(value.id)}" ${value.id === candidate.id ? 'selected' : ''}>${this.escapeHtml(value.displayName)}</option>`)
      .join('');

    mount.innerHTML = `
      <section class="node-runtime-shell probe-shell">
        <header class="node-runtime-head">
          <div>
            <div class="eyebrow">Diagnóstico ONNX</div>
            <h2>Inspección reproducible del checkpoint</h2>
            <p>Selecciona un artefacto registrado. Konta2r verifica SHA-256, observa el contrato IO real y luego evalúa su compatibilidad con el codec declarado. No ejecuta inferencia de detección durante este probe.</p>
          </div>
          <a class="probe-back" href="./">Volver al nodo</a>
        </header>
        <div class="probe-card">
          <label class="probe-candidate-field">
            <span>Candidato registrado</span>
            <select data-probe-candidate ${this.running ? 'disabled' : ''}>${options}</select>
          </label>
          <dl class="probe-facts">
            <div><dt>Candidato</dt><dd>${this.escapeHtml(candidate.displayName)}</dd></div>
            <div><dt>Rol</dt><dd>${candidate.role}</dd></div>
            <div><dt>Estado registrado</dt><dd>${candidate.status}</dd></div>
            <div><dt>Codec declarado</dt><dd>${candidate.codecId ?? 'sin codec asignado'}</dd></div>
            <div><dt>Dataset</dt><dd>${candidate.dataset}</dd></div>
            <div><dt>Input esperado</dt><dd>${candidate.inputHint ? `${candidate.inputHint.width}×${candidate.inputHint.height} ${candidate.inputHint.layout}` : 'sin hipótesis'}</dd></div>
            <div><dt>Tamaño publicado</dt><dd>${candidate.artifact.approximateSizeMb ?? '?'} MB</dd></div>
            <div><dt>Licencia declarada</dt><dd>${this.escapeHtml(candidate.artifact.declaredLicense)}</dd></div>
            <div><dt>Redistribución verificada</dt><dd>${candidate.artifact.redistributionVerified ? 'sí' : 'no'}</dd></div>
          </dl>
          <p class="runtime-note">Esta prueba descargará aproximadamente ${candidate.artifact.approximateSizeMb ?? 67} MB desde la fuente externa. El archivo no se entrega a ONNX Runtime si su SHA-256 difiere del registro. Un resultado compatible no cambia automáticamente el estado <code>${candidate.status}</code>.</p>
          ${compatibility ? `
            <div class="probe-compatibility" data-probe-compatibility>
              <strong>Compatibilidad de codec: ${compatibility.status}</strong>
              <span>${compatibility.codecId ?? 'sin codec'}</span>
              ${compatibility.errors.length > 0 ? `<p>Errores: ${this.escapeHtml(compatibility.errors.join(' · '))}</p>` : ''}
              ${compatibility.warnings.length > 0 ? `<p>Advertencias: ${this.escapeHtml(compatibility.warnings.join(' · '))}</p>` : ''}
            </div>
          ` : ''}
          <div class="node-runtime-controls">
            <button class="action" type="button" data-probe-start ${this.running ? 'disabled' : ''}>${this.running ? 'Inspeccionando…' : 'Verificar e inspeccionar modelo'}</button>
            ${diagnostic ? '<button class="action secondary" type="button" data-probe-copy>Copiar diagnóstico JSON</button><button class="action secondary" type="button" data-probe-download>Guardar diagnóstico JSON</button>' : ''}
          </div>
          <div class="runtime-error hidden" data-probe-error></div>
          <div class="probe-progress ${record ? '' : 'hidden'}" data-probe-progress>${record ? `Último probe: ${record.probedAtIso} · metadata ${record.metadataCompleteness} · codec ${compatibility?.status ?? 'no evaluado'}` : ''}</div>
          <pre class="probe-output ${diagnostic ? '' : 'hidden'}" data-probe-output>${diagnostic ? this.escapeHtml(serializeOnnxCandidateProbeDiagnosticRecord(diagnostic)) : ''}</pre>
        </div>
      </section>
    `;

    mount.querySelector<HTMLSelectElement>('[data-probe-candidate]')?.addEventListener('change', (event) => {
      if (this.running) return;
      const select = event.currentTarget as HTMLSelectElement;
      const next = DETECTOR_CANDIDATES.find((value) => value.id === select.value);
      if (!next || next.id === this.candidate.id) return;
      this.candidate = next;
      this.lastDiagnostic = null;
      this.render();
    });
    mount.querySelector<HTMLButtonElement>('[data-probe-start]')?.addEventListener('click', () => {
      void this.runProbe();
    });
    mount.querySelector<HTMLButtonElement>('[data-probe-copy]')?.addEventListener('click', () => {
      void this.copyRecord();
    });
    mount.querySelector<HTMLButtonElement>('[data-probe-download]')?.addEventListener('click', () => {
      this.downloadRecord();
    });
  }

  private async runProbe(): Promise<void> {
    if (this.running || this.destroyed) return;
    this.running = true;
    this.lastDiagnostic = null;
    this.render();
    const mount = this.mountElement;
    const progress = mount?.querySelector<HTMLElement>('[data-probe-progress]');
    const errorBox = mount?.querySelector<HTMLElement>('[data-probe-error]');
    const candidateAtStart = this.candidate;

    try {
      if (progress) {
        progress.classList.remove('hidden');
        progress.textContent = 'Descargando y verificando SHA-256…';
      }
      const artifact = await fetchVerifiedOnnxArtifact(
        candidateAtStart.artifact.url,
        candidateAtStart.artifact.sha256,
      );
      if (this.destroyed) return;

      if (progress) progress.textContent = `Checkpoint verificado (${formatMb(artifact.sizeBytes)}). Creando sesión temporal…`;
      const result = await probeOnnxModel(artifact.bytes);
      if (this.destroyed) return;

      const probeRecord = buildOnnxProbeRecord(candidateAtStart, artifact, result);
      const compatibility = assessCandidateProbeCompatibility(candidateAtStart, result);
      this.lastDiagnostic = buildOnnxCandidateProbeDiagnosticRecord(probeRecord, compatibility);
      this.running = false;
      this.render();
    } catch (error) {
      if (this.destroyed) return;
      if (progress) progress.classList.add('hidden');
      if (errorBox) {
        errorBox.classList.remove('hidden');
        errorBox.textContent = error instanceof Error ? error.message : 'model_probe_failed';
      }
      this.running = false;
      const button = this.mountElement?.querySelector<HTMLButtonElement>('[data-probe-start]');
      if (button) {
        button.disabled = false;
        button.textContent = 'Verificar e inspeccionar nuevamente';
      }
      const select = this.mountElement?.querySelector<HTMLSelectElement>('[data-probe-candidate]');
      if (select) select.disabled = false;
    }
  }

  private async copyRecord(): Promise<void> {
    const diagnostic = this.lastDiagnostic;
    if (!diagnostic) return;
    const text = serializeOnnxCandidateProbeDiagnosticRecord(diagnostic);
    if (!navigator.clipboard?.writeText) {
      this.showTransientError('Clipboard API no disponible. Usa “Guardar diagnóstico JSON”.');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      const progress = this.mountElement?.querySelector<HTMLElement>('[data-probe-progress]');
      if (progress) progress.textContent = `Diagnóstico copiado · ${diagnostic.probe.probedAtIso}`;
    } catch (error) {
      this.showTransientError(error instanceof Error ? error.message : 'clipboard_write_failed');
    }
  }

  private downloadRecord(): void {
    const diagnostic = this.lastDiagnostic;
    if (!diagnostic) return;
    const blob = new Blob(
      [serializeOnnxCandidateProbeDiagnosticRecord(diagnostic)],
      { type: 'application/json;charset=utf-8' },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `konta2r-probe-${diagnostic.probe.candidateId}-${safeFileTimestamp(diagnostic.probe.probedAtIso)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  private showTransientError(message: string): void {
    const errorBox = this.mountElement?.querySelector<HTMLElement>('[data-probe-error]');
    if (!errorBox) return;
    errorBox.classList.remove('hidden');
    errorBox.textContent = message;
  }

  private escapeHtml(value: string): string {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  }
}
