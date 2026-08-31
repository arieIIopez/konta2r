import { BrowserVideoBenchmarkFrameProvider } from '../detection/browserVideoFrameProvider';
import { parseAnnotatedBenchmarkSequenceJson, type AnnotatedBenchmarkSequence } from '../detection/benchmarkDatasetParser';
import {
  detectorBenchmarkStrataCsv,
  detectorBenchmarkSummaryCsv,
} from '../detection/benchmarkReport';
import {
  runExternalCandidateBenchmarkSession,
  type ExternalBenchmarkSessionResult,
} from '../detection/externalBenchmarkSession';
import {
  hashLocalBenchmarkBlob,
  verifiedOnnxArtifactFromLocalBlob,
} from '../detection/localBenchmarkFiles';
import {
  reviewImportedProbeDiagnostic,
  type ImportedProbeDiagnosticReview,
} from '../detection/onnx/probeDiagnosticReview';

const DETECTOR_MIN_CONFIDENCE = 0.5;

type BenchmarkProfile = 'development' | 'selection';

interface LocalInputs {
  diagnostic: File | null;
  model: File | null;
  annotations: File | null;
  video: File | null;
}

function fileSizeMb(file: File | null): string {
  return file ? `${(file.size / (1024 * 1024)).toFixed(1)} MB` : '—';
}

function finiteText(value: number | null | undefined, digits = 3): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? '—'
    : value.toFixed(digits);
}

function safeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'benchmark';
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

function benchmarkResultJson(result: ExternalBenchmarkSessionResult): string {
  return `${JSON.stringify({
    schemaVersion: '1',
    recordType: 'konta2r_external_detector_benchmark',
    ...result,
  }, null, 2)}\n`;
}

export class BenchmarkPanel {
  private mountElement: HTMLElement | null = null;
  private destroyed = false;
  private running = false;
  private inputs: LocalInputs = {
    diagnostic: null,
    model: null,
    annotations: null,
    video: null,
  };
  private review: ImportedProbeDiagnosticReview | null = null;
  private sequence: AnnotatedBenchmarkSequence | null = null;
  private result: ExternalBenchmarkSessionResult | null = null;
  private profile: BenchmarkProfile = 'selection';
  private iouThreshold = 0.5;
  private progress = 'Selecciona los cuatro archivos locales para preparar la corrida.';
  private error: string | null = null;
  private videoObjectUrl: string | null = null;

  mount(element: HTMLElement): void {
    this.mountElement = element;
    this.render();
  }

  destroy(): void {
    this.destroyed = true;
    this.revokeVideoUrl();
    if (this.mountElement) this.mountElement.replaceChildren();
    this.mountElement = null;
    this.result = null;
    this.review = null;
    this.sequence = null;
  }

  private render(): void {
    const mount = this.mountElement;
    if (!mount || this.destroyed) return;
    const review = this.review;
    const sequence = this.sequence;
    const result = this.result;
    const ready = this.isReadyToRun();
    const timedFrames = sequence?.frames.filter((frame) => frame.mediaTimeMs !== undefined).length ?? 0;
    const allFramesTimed = sequence ? timedFrames === sequence.frames.length : false;

    mount.innerHTML = `
      <section class="node-runtime-shell benchmark-shell">
        <header class="node-runtime-head">
          <div>
            <div class="eyebrow">Benchmark local</div>
            <h2>Ensayo reproducible de detector</h2>
            <p>Ejecuta un checkpoint externo contra video y ground truth locales. Konta2r verifica identidad, sincronización y validez metodológica antes de presentar la corrida como evidencia.</p>
          </div>
          <a class="probe-back" href="./">Volver al nodo</a>
        </header>

        <div class="benchmark-body">
          <div class="benchmark-input-grid">
            ${this.inputCard('diagnostic', '1 · Diagnóstico ONNX', this.inputs.diagnostic, review
              ? `${review.candidate.displayName} · gate ${review.verification.status}`
              : 'JSON exportado desde ?diagnostics=onnx', '.json,application/json')}
            ${this.inputCard('model', '2 · Checkpoint ONNX', this.inputs.model, review
              ? `Esperado ${review.candidate.artifact.sha256.slice(0, 12)}… · ${fileSizeMb(this.inputs.model)}`
              : 'Selecciona primero el diagnóstico', '.onnx,application/octet-stream')}
            ${this.inputCard('annotations', '3 · Anotaciones', this.inputs.annotations, sequence
              ? `${sequence.datasetId} / ${sequence.sequenceId} · ${sequence.frames.length} frames · mediaTime ${timedFrames}/${sequence.frames.length}`
              : 'AnnotatedBenchmarkSequence JSON', '.json,application/json')}
            ${this.inputCard('video', '4 · Video local', this.inputs.video, this.inputs.video
              ? `${this.inputs.video.name} · ${fileSizeMb(this.inputs.video)}`
              : 'Video asociado a las anotaciones', 'video/*')}
          </div>

          <div class="benchmark-controls">
            <label>
              <span>Perfil de validez</span>
              <select data-benchmark-profile ${this.running ? 'disabled' : ''}>
                <option value="selection" ${this.profile === 'selection' ? 'selected' : ''}>selection · evidencia estricta</option>
                <option value="development" ${this.profile === 'development' ? 'selected' : ''}>development · evidencia provisional</option>
              </select>
            </label>
            <label>
              <span>IoU de matching</span>
              <input data-benchmark-iou type="number" min="0.1" max="0.95" step="0.05" value="${this.iouThreshold}" ${this.running ? 'disabled' : ''}>
            </label>
            <div class="benchmark-fixed">
              <span>Confidence detector</span>
              <strong>${DETECTOR_MIN_CONFIDENCE.toFixed(2)}</strong>
              <small>Fijo y registrado en esta primera versión.</small>
            </div>
          </div>

          <p class="runtime-note">Todo se procesa localmente. El video, el checkpoint y las anotaciones no se suben a Community ni al backend. En <code>selection</code> se exige evidencia del frame presentado y seek ≤50 ms. ${sequence && !allFramesTimed ? '<strong>El corpus contiene frames sin mediaTimeMs y no puede ejecutarse contra video.</strong>' : ''}</p>

          ${review ? this.verificationBlock(review) : ''}

          <div class="node-runtime-controls benchmark-actions">
            <button class="action primary" type="button" data-benchmark-run ${ready && !this.running ? '' : 'disabled'}>${this.running ? 'Ejecutando…' : 'Verificar archivos y ejecutar benchmark'}</button>
            ${result ? '<button class="action secondary" type="button" data-benchmark-json>Guardar JSON</button><button class="action secondary" type="button" data-benchmark-summary>Guardar resumen CSV</button><button class="action secondary" type="button" data-benchmark-strata>Guardar estratos CSV</button>' : ''}
          </div>

          <div class="benchmark-progress">${this.escapeHtml(this.progress)}</div>
          ${this.error ? `<div class="runtime-error">${this.escapeHtml(this.error)}</div>` : ''}
          <video class="benchmark-video ${this.inputs.video ? '' : 'hidden'}" data-benchmark-video muted playsinline preload="metadata"></video>
          ${result ? this.resultBlock(result) : ''}
        </div>
      </section>
    `;

    for (const key of ['diagnostic', 'model', 'annotations', 'video'] as const) {
      mount.querySelector<HTMLInputElement>(`[data-benchmark-file="${key}"]`)?.addEventListener('change', (event) => {
        const input = event.currentTarget as HTMLInputElement;
        const file = input.files?.[0] ?? null;
        void this.handleFile(key, file);
      });
    }

    mount.querySelector<HTMLSelectElement>('[data-benchmark-profile]')?.addEventListener('change', (event) => {
      const value = (event.currentTarget as HTMLSelectElement).value;
      this.profile = value === 'development' ? 'development' : 'selection';
      this.result = null;
      this.render();
    });
    mount.querySelector<HTMLInputElement>('[data-benchmark-iou]')?.addEventListener('change', (event) => {
      const value = Number((event.currentTarget as HTMLInputElement).value);
      if (Number.isFinite(value) && value >= 0.1 && value <= 0.95) this.iouThreshold = value;
      this.result = null;
      this.render();
    });
    mount.querySelector<HTMLButtonElement>('[data-benchmark-run]')?.addEventListener('click', () => {
      void this.run();
    });
    mount.querySelector<HTMLButtonElement>('[data-benchmark-json]')?.addEventListener('click', () => this.downloadJson());
    mount.querySelector<HTMLButtonElement>('[data-benchmark-summary]')?.addEventListener('click', () => this.downloadSummary());
    mount.querySelector<HTMLButtonElement>('[data-benchmark-strata]')?.addEventListener('click', () => this.downloadStrata());
  }

  private inputCard(
    key: keyof LocalInputs,
    title: string,
    file: File | null,
    detail: string,
    accept: string,
  ): string {
    return `
      <label class="benchmark-file-card ${file ? 'loaded' : ''}">
        <span>${title}</span>
        <strong>${file ? this.escapeHtml(file.name) : 'Seleccionar archivo'}</strong>
        <small>${this.escapeHtml(detail)}</small>
        <input data-benchmark-file="${key}" type="file" accept="${accept}" ${this.running ? 'disabled' : ''}>
      </label>
    `;
  }

  private verificationBlock(review: ImportedProbeDiagnosticReview): string {
    const verification = review.verification;
    return `
      <div class="benchmark-verification verification-${verification.status}">
        <strong>Probe técnico: ${verification.status}</strong>
        <span>${this.escapeHtml(review.candidate.id)} · codec ${this.escapeHtml(review.candidate.codecId ?? 'sin codec')}</span>
        ${verification.findings.length === 0
          ? '<p>Identidad, metadata y contrato compatibles con el candidato registrado.</p>'
          : `<p>${this.escapeHtml(verification.findings.map((finding) => `${finding.severity}:${finding.code}`).join(' · '))}</p>`}
      </div>
    `;
  }

  private resultBlock(result: ExternalBenchmarkSessionResult): string {
    const benchmark = result.report.benchmark;
    const validity = result.validity;
    const seek = benchmark.mediaSeek;
    return `
      <section class="benchmark-result validity-${validity.status}">
        <div class="benchmark-result-head">
          <div><span>Validez científica</span><strong>${validity.status}</strong></div>
          <div><span>Modelo</span><strong>${this.escapeHtml(benchmark.detector.model.modelId)}</strong></div>
          <div><span>Backend</span><strong>${benchmark.detector.runtime.backend}</strong></div>
          <div><span>Frames</span><strong>${benchmark.frameCount}</strong></div>
        </div>
        <div class="benchmark-metrics">
          <div><span>Macro F1</span><strong>${finiteText(benchmark.macroF1)}</strong></div>
          <div><span>IoU medio TP</span><strong>${finiteText(benchmark.matchedIoUMean)}</strong></div>
          <div><span>Inferencia p95</span><strong>${finiteText(benchmark.latency.inferenceMsP95, 1)} ms</strong></div>
          <div><span>FPS efectivo</span><strong>${finiteText(benchmark.latency.effectiveInferenceFps, 2)}</strong></div>
          <div><span>Seek máx.</span><strong>${finiteText(seek?.absoluteErrorMaxMs, 1)} ms</strong></div>
          <div><span>Hash modelo</span><strong class="mono">${benchmark.detector.model.modelSha256?.slice(0, 12) ?? '—'}…</strong></div>
        </div>
        ${validity.findings.length > 0 ? `<div class="benchmark-findings">${validity.findings.map((finding) => `<p><b>${finding.severity}</b> · ${this.escapeHtml(finding.code)} — ${this.escapeHtml(finding.message)}</p>`).join('')}</div>` : '<div class="benchmark-findings"><p>Sin hallazgos del gate de validez para este perfil.</p></div>'}
        <div class="benchmark-class-table">
          <table>
            <thead><tr><th>Clase</th><th>TP</th><th>FP</th><th>FN</th><th>Precision</th><th>Recall</th><th>F1</th></tr></thead>
            <tbody>${benchmark.classMetrics.map((metric) => `<tr><td>${this.escapeHtml(metric.className)}</td><td>${metric.truePositive}</td><td>${metric.falsePositive}</td><td>${metric.falseNegative}</td><td>${finiteText(metric.precision)}</td><td>${finiteText(metric.recall)}</td><td>${finiteText(metric.f1)}</td></tr>`).join('')}</tbody>
          </table>
        </div>
      </section>
    `;
  }

  private async handleFile(key: keyof LocalInputs, file: File | null): Promise<void> {
    if (this.running || this.destroyed) return;
    this.inputs[key] = file;
    this.result = null;
    this.error = null;
    try {
      if (key === 'diagnostic') {
        this.review = file ? reviewImportedProbeDiagnostic(await file.text()) : null;
      } else if (key === 'annotations') {
        this.sequence = file ? parseAnnotatedBenchmarkSequenceJson(await file.text()) : null;
      }
      this.progress = file ? `${file.name} cargado localmente.` : 'Archivo removido.';
    } catch (error) {
      if (key === 'diagnostic') this.review = null;
      if (key === 'annotations') this.sequence = null;
      this.error = error instanceof Error ? error.message : 'local_input_parse_failed';
      this.progress = 'Entrada rechazada antes de ejecutar el benchmark.';
    }
    this.render();
  }

  private isReadyToRun(): boolean {
    const { diagnostic, model, annotations, video } = this.inputs;
    return Boolean(
      diagnostic && model && annotations && video
      && this.review?.verification.status === 'verified'
      && this.sequence
      && this.sequence.frames.length > 0
      && this.sequence.frames.every((frame) => frame.mediaTimeMs !== undefined),
    );
  }

  private async run(): Promise<void> {
    if (!this.isReadyToRun() || this.running || this.destroyed) return;
    const review = this.review;
    const sequence = this.sequence;
    const modelFile = this.inputs.model;
    const annotationFile = this.inputs.annotations;
    const videoFile = this.inputs.video;
    if (!review || !sequence || !modelFile || !annotationFile || !videoFile) return;

    this.running = true;
    this.result = null;
    this.error = null;
    this.progress = 'Verificando checkpoint local…';
    this.render();

    try {
      const artifact = await verifiedOnnxArtifactFromLocalBlob(
        modelFile,
        review.candidate.artifact.sha256,
        { onProgress: (value) => this.setProgress(`Hash ONNX ${(value.ratio * 100).toFixed(0)}%`) },
      );
      if (this.destroyed) return;

      this.setProgress('Calculando SHA-256 de las anotaciones…');
      const annotationSha256 = await hashLocalBenchmarkBlob(annotationFile, {
        onProgress: (value) => this.setProgress(`Hash anotaciones ${(value.ratio * 100).toFixed(0)}%`),
      });
      if (this.destroyed) return;

      this.setProgress('Calculando SHA-256 incremental del video…');
      const mediaSha256 = await hashLocalBenchmarkBlob(videoFile, {
        onProgress: (value) => this.setProgress(`Hash video ${(value.ratio * 100).toFixed(0)}%`),
      });
      if (this.destroyed) return;

      this.revokeVideoUrl();
      const video = this.mountElement?.querySelector<HTMLVideoElement>('[data-benchmark-video]');
      if (!video) throw new Error('Benchmark video element is unavailable');
      this.videoObjectUrl = URL.createObjectURL(videoFile);
      video.src = this.videoObjectUrl;
      video.load();

      const strict = this.profile === 'selection';
      const provider = new BrowserVideoBenchmarkFrameProvider(video, {
        seekToleranceMs: strict ? 50 : 100,
        requireDimensionMatch: true,
        requirePresentedFrameTime: strict,
      });
      const nav = navigator as Navigator & { deviceMemory?: number };
      const result = await runExternalCandidateBenchmarkSession(
        review.candidate,
        artifact,
        review.diagnostic,
        sequence,
        provider,
        {
          runId: `konta2r-${safeFilePart(review.candidate.id)}-${Date.now()}`,
          device: {
            label: `browser-${navigator.platform || 'unknown'}`,
            userAgent: navigator.userAgent,
            hardwareConcurrency: navigator.hardwareConcurrency,
            ...(nav.deviceMemory === undefined ? {} : { deviceMemoryGiB: nav.deviceMemory }),
            webgpuAvailable: 'gpu' in navigator,
          },
          corpusHashes: { annotationSha256, mediaSha256 },
          detector: {
            minConfidence: DETECTOR_MIN_CONFIDENCE,
            preferWebGpu: true,
          },
          benchmark: {
            iouThreshold: this.iouThreshold,
            onProgress: (value) => this.setProgress(`Inferencia ${value.completedFrames}/${value.totalFrames} · ${value.frameId}`),
          },
          validity: { profile: this.profile },
          notes: [
            'benchmark_surface:?diagnostics=benchmark',
            `detector_min_confidence:${DETECTOR_MIN_CONFIDENCE}`,
            `validity_profile:${this.profile}`,
          ],
        },
      );
      if (this.destroyed) return;
      this.result = result;
      this.progress = `Benchmark completo · ${result.validity.status} · ${result.report.benchmark.frameCount} frames.`;
    } catch (error) {
      if (this.destroyed) return;
      this.error = error instanceof Error ? error.message : 'benchmark_run_failed';
      this.progress = 'La corrida se detuvo; no se exportó evidencia como válida.';
    } finally {
      this.running = false;
      if (!this.destroyed) this.render();
    }
  }

  private setProgress(message: string): void {
    this.progress = message;
    const element = this.mountElement?.querySelector<HTMLElement>('.benchmark-progress');
    if (element) element.textContent = message;
  }

  private downloadJson(): void {
    const result = this.result;
    if (!result) return;
    const stem = safeFilePart(result.report.runId);
    downloadText(`${stem}.json`, benchmarkResultJson(result), 'application/json;charset=utf-8');
  }

  private downloadSummary(): void {
    const result = this.result;
    if (!result) return;
    const stem = safeFilePart(result.report.runId);
    downloadText(`${stem}-summary.csv`, detectorBenchmarkSummaryCsv(result.report), 'text/csv;charset=utf-8');
  }

  private downloadStrata(): void {
    const result = this.result;
    if (!result) return;
    const stem = safeFilePart(result.report.runId);
    downloadText(`${stem}-strata.csv`, detectorBenchmarkStrataCsv(result.report), 'text/csv;charset=utf-8');
  }

  private revokeVideoUrl(): void {
    if (!this.videoObjectUrl) return;
    URL.revokeObjectURL(this.videoObjectUrl);
    this.videoObjectUrl = null;
  }

  private escapeHtml(value: string): string {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  }
}
