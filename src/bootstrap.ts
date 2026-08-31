import './node.css';
import { registerKonta2rServiceWorker } from './pwa/register';

async function bootstrap(): Promise<void> {
  const pwa = await registerKonta2rServiceWorker();
  const mount = document.querySelector<HTMLElement>('#node-runtime');
  if (!mount) return;

  const diagnostics = new URLSearchParams(window.location.search).get('diagnostics');
  if (diagnostics === 'onnx') {
    const { ModelProbePanel } = await import('./diagnostics/modelProbePanel');
    const panel = new ModelProbePanel();
    panel.mount(mount);
    window.addEventListener('beforeunload', () => panel.destroy(), { once: true });
    return;
  }
  if (diagnostics === 'benchmark') {
    await import('./benchmark.css');
    const { BenchmarkPanel } = await import('./diagnostics/benchmarkPanel');
    const panel = new BenchmarkPanel();
    panel.mount(mount);
    window.addEventListener('beforeunload', () => panel.destroy(), { once: true });
    return;
  }
  if (diagnostics === 'annotate') {
    await import('./diagnostics/annotation.css');
    const { AnnotationPanel } = await import('./diagnostics/annotationPanel');
    const panel = new AnnotationPanel();
    panel.mount(mount);
    window.addEventListener('beforeunload', () => panel.destroy(), { once: true });
    return;
  }

  await import('./main');
  const { NodePanel } = await import('./node/nodePanel');
  const panel = new NodePanel(pwa);
  panel.mount(mount);
  window.addEventListener('beforeunload', () => panel.destroy(), { once: true });
}

void bootstrap();
