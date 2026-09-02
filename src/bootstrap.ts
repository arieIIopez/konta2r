import './node.css';
import type { NodePilotPipelineFactory } from './node/pilotPipeline';
import { registerKonta2rServiceWorker } from './pwa/register';
import { KONTA2R_METHODOLOGY_VERSION, KONTA2R_VERSION } from './version';

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
  if (diagnostics === 'corpus') {
    await import('./diagnostics/corpus.css');
    const { CorpusPanel } = await import('./diagnostics/corpusPanel');
    const panel = new CorpusPanel();
    panel.mount(mount);
    window.addEventListener('beforeunload', () => panel.destroy(), { once: true });
    return;
  }
  if (diagnostics === 'manifest') {
    await import('./diagnostics/corpus.css');
    const { CorpusManifestPanel } = await import('./diagnostics/corpusManifestPanel');
    const panel = new CorpusManifestPanel();
    panel.mount(mount);
    window.addEventListener('beforeunload', () => panel.destroy(), { once: true });
    return;
  }
  if (diagnostics === 'manifest-build') {
    await import('./diagnostics/corpus.css');
    const { CorpusManifestBuilderPanel } = await import('./diagnostics/corpusManifestBuilderPanel');
    const panel = new CorpusManifestBuilderPanel();
    panel.mount(mount);
    window.addEventListener('beforeunload', () => panel.destroy(), { once: true });
    return;
  }
  if (diagnostics === 'pilot') {
    await import('./diagnostics/pilotCapture.css');
    const { PilotCapturePanel } = await import('./diagnostics/pilotCapturePanel');
    const panel = new PilotCapturePanel();
    panel.mount(mount);
    window.addEventListener('beforeunload', () => panel.destroy(), { once: true });
    return;
  }

  await import('./main');
  const [
    { NodePanel },
    { createBrowserNodeCommunity, createBrowserCommunityFlowRuntime },
    { CountingGeometryPanel },
  ] = await Promise.all([
    import('./node/nodePanel'),
    import('./community/browserNodeCommunity'),
    import('./node/countingGeometryPanel'),
  ]);
  const community = createBrowserNodeCommunity({
    projectUrl: import.meta.env.VITE_SUPABASE_URL,
    publishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    appOrigin: window.location.origin,
  });

  let pilotPipelineFactory: NodePilotPipelineFactory | undefined;
  if (import.meta.env.VITE_KONTA2R_EXPERIMENTAL_DETECTOR === 'nanodet') {
    const { NanoDetPilotPipeline } = await import('./detection/nanodetPilotPipeline');
    pilotPipelineFactory = (maxDetections) => new NanoDetPilotPipeline({ maxDetections });
  }

  const panel = new NodePanel(pwa, community, {
    ...(pilotPipelineFactory === undefined ? {} : { pilotPipelineFactory }),
  });
  panel.mount(mount);

  const flowRuntime = createBrowserCommunityFlowRuntime({
    community,
    runtime: { snapshot: () => panel.runtimeSnapshot() },
    pipeline: { getInitialization: () => panel.detectorInitialization() },
    softwareVersion: KONTA2R_VERSION,
    methodologyVersion: KONTA2R_METHODOLOGY_VERSION,
  });
  panel.attachCommunityFlowRuntime(flowRuntime);

  const geometryPanel = new CountingGeometryPanel({
    onOperationalGeometryChange: (configuration) => panel.setCountingGeometry(configuration),
  });
  geometryPanel.mount(mount);
  window.addEventListener('beforeunload', () => {
    geometryPanel.destroy();
    panel.destroy();
  }, { once: true });
}

void bootstrap();
