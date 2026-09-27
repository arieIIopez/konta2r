import { parseAnnotatedBenchmarkSequenceJson } from '../detection/benchmarkDatasetParser';
import {
  summarizeCorpusComposition,
  type CorpusCompositionReport,
} from '../detection/corpusComposition';

function html(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function percent(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

function countRows(record: Record<string, number>): string {
  const entries = Object.entries(record).sort(([a], [b]) => a.localeCompare(b));
  return entries.length === 0
    ? '<p class="corpus-empty">Sin observaciones.</p>'
    : entries.map(([key, value]) => `<div class="corpus-count-row"><span>${html(key)}</span><strong>${value}</strong></div>`).join('');
}

export class CorpusPanel {
  private mountElement: HTMLElement | null = null;
  private filename: string | null = null;
  private report: CorpusCompositionReport | null = null;
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
    const coverage = report?.samplingCoverage;

    mount.innerHTML = `
      <section class="node-runtime-shell corpus-shell">
        <header class="node-runtime-head">
          <div>
            <div class="eyebrow">Control descriptivo</div>
            <h2>Composición del corpus</h2>
            <p>Revisa qué contiene una secuencia antes de usarla en benchmark. Esta herramienta no entrega un score ni declara el corpus válido/inválido.</p>
          </div>
          <a class="probe-back" href="./?diagnostics=annotate">Ir al anotador</a>
        </header>

        <div class="corpus-input-card">
          <label>
            <span>Anotaciones JSON</span>
            <strong>${this.filename ? html(this.filename) : 'Selecciona un AnnotatedBenchmarkSequence'}</strong>
            <input data-corpus-file type="file" accept=".json,application/json">
          </label>
          <p>El archivo se parsea localmente con el mismo validador del benchmark; no se sube a un servidor.</p>
        </div>

        ${report ? `
          <div class="corpus-kpis">
            <div><span>Frames</span><strong>${report.frameCount}</strong></div>
            <div><span>Objetos evaluables</span><strong>${report.evaluableObjectCount}</strong></div>
            <div><span>Ignorados</span><strong>${report.ignoredObjectCount}</strong></div>
            <div><span>Frames negativos</span><strong>${report.negativeFrameCount}</strong></div>
            <div><span>Muestreo planificado</span><strong>${coverage ? `${coverage.capturedPlannedCount}/${coverage.plannedCount}` : '—'}</strong><small>${coverage ? percent(coverage.ratio) : 'sin plan'}</small></div>
            <div><span>Frames manuales</span><strong>${report.selectionCounts.manual}</strong></div>
          </div>

          <div class="corpus-grid">
            <section class="corpus-card"><h3>Clases</h3>${countRows(report.classCounts)}</section>
            <section class="corpus-card"><h3>Oclusión evaluable</h3>${countRows(report.occlusionCounts)}</section>
            <section class="corpus-card"><h3>Escala en imagen</h3>${countRows(report.imageScaleCounts)}</section>
            <section class="corpus-card"><h3>Procedencia de frames</h3>${countRows(report.selectionCounts)}</section>
          </div>

          <section class="corpus-findings">
            <h3>Lectura de composición</h3>
            ${report.findings.length === 0
              ? '<p class="corpus-empty">No se generaron observaciones descriptivas automáticas.</p>'
              : report.findings.map((finding) => `
                  <div class="corpus-finding ${finding.severity}">
                    <strong>${finding.severity === 'warning' ? 'Revisar' : 'Información'}${finding.className ? ` · ${html(finding.className)}` : ''}</strong>
                    <p>${html(finding.message)}</p>
                  </div>
                `).join('')}
          </section>

          <p class="runtime-note corpus-method-note">Estos hallazgos describen una <strong>secuencia</strong>. La suficiencia del corpus completo depende además de cómo se combinan ubicaciones, dispositivos, iluminación, densidad y condiciones de observación. Una clase ausente aquí no implica por sí sola un error de diseño.</p>
        ` : ''}

        ${this.error ? `<div class="runtime-error">${html(this.error)}</div>` : ''}
      </section>
    `;

    mount.querySelector<HTMLInputElement>('[data-corpus-file]')?.addEventListener('change', (event) => {
      void this.load((event.currentTarget as HTMLInputElement).files?.[0] ?? null);
    });
  }

  private async load(file: File | null): Promise<void> {
    if (!file) return;
    try {
      const sequence = parseAnnotatedBenchmarkSequenceJson(await file.text());
      this.report = summarizeCorpusComposition(sequence);
      this.filename = file.name;
      this.error = null;
    } catch (error) {
      this.report = null;
      this.filename = file.name;
      this.error = error instanceof Error ? error.message : 'corpus_composition_failed';
    }
    this.render();
  }
}
