import './node.css';
import './main';
import { NodePanel } from './node/nodePanel';
import { registerKonta2rServiceWorker } from './pwa/register';

async function bootstrapNode(): Promise<void> {
  const pwa = await registerKonta2rServiceWorker();
  const mount = document.querySelector<HTMLElement>('#node-runtime');
  if (!mount) return;

  const panel = new NodePanel(pwa);
  panel.mount(mount);
  window.addEventListener('beforeunload', () => panel.destroy(), { once: true });
}

void bootstrapNode();
