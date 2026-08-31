import { parseCorpusManifestJson } from '../detection/corpusManifestParser';
import {
  summarizeCorpusManifestCoverage,
  type CorpusManifestCoverage,
} from '../detection/corpusManifest';

function html(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function countRows(record: Record<string, number>): string {
  const entries = Object.entries(record).sort(([a], [b]) => a.localeCompare(b));
  return entries.length === 0
    ? '<p class="corpus-empty">Sin observaciones.</p>'
    : entries.map(([key, value]) => `<div class="corpus-count-row"><span>${html(key)}</span><strong>${value}</strong></div>`).join('');
}

export class CorpusManifestPanel {
  private mountElement: HTMLElement | null = null;
  private filename: string | null = null;
  private corpusId: string | null = null;
  private report: CorpusManifestCoverage | null = null;
  private error: string | null = null;

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
    const report = this.report;

    mount.innerHTML = `
      <section class="node-runtime-shell corpus-shell">
        <header class="node-runtime-head">
          <div>
            <div class="eyebrow">Diseño multi-secuencia</div>
            <h2>Cobertura del manifest del corpus</h2>
            <p>Revisa splits, sitios pseudónimos y condiciones de observación antes de usar el corpus completo para selección o evaluación final. No calcula un score de representatividad.</p>
          </div>
          <a class="probe-back" href="./?diagnostics=corpus">Revisar una secuencia</a>
        </header>

        <div class="corpus-input-card">
          <label>
            <span>Corpus manifest JSON</span>
            <strong>${this.filename ? html(this.filename) : 'Selecciona un CorpusManifest'}</strong>
            <input data-manifest-file type="file" accept=".json,application/json">
          </label>
          <p>El manifest contiene hashes, splits y descriptores de escena. <code>siteId</code> es un token opaco; no debe contener domicilio ni coordenadas.</p>
        </div>

        ${report ? `
          <div class="corpus-kpis">
            <div><span>Corpus</span><strong>${html(this.corpusId ?? '—')}</strong></div>
            <div><span>Secuencias</span><strong>${report.sequenceCount}</strong></div>
            <div><span>Sitios pseudónimos</span><strong>${report.siteCount}</strong></div>
            <div><span>Development</span><strong>${report.splitCounts.development}</strong></div>
            <div><span>Validation</span><strong>${report.splitCounts.validation}</strong></div>
            <div><span>Held-out test</span><strong>${report.splitCounts.held_out_test}</strong></div>
          </div>

          <div class="corpus-grid">
            <section class="corpus-card"><h3>Tipo de escena</h3>${countRows(report.sceneTypeCounts)}</section>
            <section class="corpus-card"><h3>Iluminación</h3>${countRows(report.lightingCounts)}</section>
            <section class="corpus-card"><h3>Ángulo de vista</h3>${countRows(report.viewAngleCounts)}</section>
            <section class="corpus-card"><h3>Perfil de dispositivo</h3>${countRows(report.deviceProfileCounts)}</section>
          </div>

          <section class="corpus-findings">
            <h3>Lectura del diseño experimental</h3>
            ${report.findings.length === 0
              ? '<p class="corpus-empty">No se generaron observaciones descriptivas automáticas.</p>'
              : report.findings.map((finding) => `
                  <div class="corpus-finding ${finding.severity}">
                    <strong>${finding.severity === 'warning' ? 'Revisar' : 'Información'} · ${html(finding.code)}</strong>
                    <p>${html(finding.message)}</p>
                  </div>
                `).join('')}
          </section>

          ${report.sitesAcrossMultipleSplits.length > 0 ? `
            <section class="corpus-findings">
              <h3>Sitios presentes en más de un split</h3>
              <p class="corpus-empty">${report.sitesAcrossMultipleSplits.map(html).join(' · ')}</p>
            </section>
          ` : ''}

          <p class="runtime-note corpus-method-note">Un held-out que comparte <strong>siteId</strong> con desarrollo/validación puede seguir siendo útil para evaluar cambios temporales o de iluminación, pero no demuestra generalización espacial a una cámara/sitio nunca visto. El manifest describe esa dependencia; la decisión científica sigue siendo del protocolo.</p>
        ` : ''}

        ${this.error ? `<div class="runtime-error">${html(this.error)}</div>` : ''}
      </section>
    `;

    mount.querySelector<HTMLInputElement>('[data-manifest-file]')?.addEventListener('change', (event) => {
      void this.load((event.currentTarget as HTMLInputElement).files?.[0] ?? null);
    });
  }

  private async load(file: File | null): Promise<void> {
    if (!file) return;
    try {
      const manifest = parseCorpusManifestJson(await file.text());
      this.report = summarizeCorpusManifestCoverage(manifest);
      this.corpusId = manifest.corpusId;
      this.filename = file.name;
      this.error = null;
    } catch (error) {
      this.report = null;
      this.corpusId = null;
      this.filename = file.name;
      this.error = error instanceof Error ? error.message : 'corpus_manifest_failed';
    }
    this.render();
  }
}
