import type {
  NodeCommunityIdentity,
  NodeCommunityRuntime,
  NodeCommunitySnapshot,
} from '../community/nodeCommunityController';

function setText(root: HTMLElement, selector: string, value: string): void {
  const element = root.querySelector<HTMLElement>(selector);
  if (element) element.textContent = value;
}

function setVisible(root: HTMLElement, selector: string, visible: boolean): void {
  root.querySelector<HTMLElement>(selector)?.classList.toggle('hidden', !visible);
}

function setDisabled(root: HTMLElement, selector: string, disabled: boolean): void {
  const element = root.querySelector<HTMLButtonElement | HTMLInputElement>(selector);
  if (element) element.disabled = disabled;
}

function statusLabel(snapshot: NodeCommunitySnapshot): string {
  if (!snapshot.configured) return 'no configurado';
  if (!snapshot.identity) return 'sin nodo';
  const labels: Record<NodeCommunityIdentity['status'], string> = {
    provisioning: 'provisionando',
    active: 'activo',
    paused: 'pausado',
    revoked: 'revocado',
  };
  return labels[snapshot.identity.status];
}

function statusHelp(snapshot: NodeCommunitySnapshot): string {
  if (!snapshot.configured) {
    return 'Configura VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY para habilitar la red Community.';
  }
  if (!snapshot.identity) {
    return snapshot.human.authenticated
      ? 'Define un nombre y segmento para convertir este teléfono en un nodo ciudadano.'
      : 'Conecta Google sólo para registrar o administrar este teléfono.';
  }
  if (snapshot.identity.status === 'active') {
    return snapshot.sensorReady
      ? 'El sensor puede operar y enviar agregados aunque cierres la sesión humana.'
      : 'El nodo figura activo, pero la credencial local no está disponible.';
  }
  if (snapshot.identity.status === 'provisioning') {
    return 'La identidad quedó guardada localmente. Puedes reintentar la activación sin volver a registrar el teléfono.';
  }
  if (snapshot.identity.status === 'paused') {
    return 'El nodo conserva su identidad, pero no debe enviar nuevos agregados hasta reactivarlo.';
  }
  return 'La revocación es terminal. La credencial local ya no está disponible.';
}

export class NodeCommunityPanel {
  private readonly runtime: NodeCommunityRuntime;
  private root: HTMLElement | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(runtime: NodeCommunityRuntime) {
    this.runtime = runtime;
  }

  mount(root: HTMLElement): void {
    this.root = root;
    root.innerHTML = `
      <section class="community-panel" data-community-state="unconfigured">
        <div class="community-head">
          <div>
            <span class="eyebrow">Konta2r Community</span>
            <h3>Red ciudadana</h3>
            <p data-community-help>Comprobando identidad local…</p>
          </div>
          <span class="status-pill" data-community-status>○ comprobando</span>
        </div>

        <div class="community-facts">
          <div><span>Nodo</span><strong data-community-node>—</strong><small data-community-label>sin registrar</small></div>
          <div><span>Segmento</span><strong data-community-segment>—</strong><small>la ubicación pública se asocia al segmento, no a la vivienda</small></div>
          <div><span>Sesión humana</span><strong data-community-human>cerrada</strong><small>Google se usa sólo para administración</small></div>
          <div><span>Envío de agregados</span><strong data-community-transport>no disponible</strong><small>la credencial del sensor nunca se muestra aquí</small></div>
        </div>

        <div class="community-enroll" data-community-enroll>
          <label>Nombre del nodo
            <input data-community-label-input maxlength="80" autocomplete="off" placeholder="ej. ventana norte">
          </label>
          <label>Segmento público
            <input data-community-segment-input maxlength="120" autocomplete="off" placeholder="ej. segment-alameda-001">
          </label>
        </div>

        <div class="community-actions">
          <button class="action primary" data-community-signin>Conectar Google</button>
          <button class="action primary hidden" data-community-provision>Registrar y activar</button>
          <button class="action hidden" data-community-activate>Activar</button>
          <button class="action hidden" data-community-pause>Pausar</button>
          <button class="action hidden" data-community-rotate>Rotar credencial</button>
          <button class="action hidden danger" data-community-revoke>Revocar nodo</button>
          <button class="action hidden" data-community-signout>Cerrar sesión humana</button>
          <button class="action hidden" data-community-clear>Olvidar nodo revocado</button>
        </div>
        <p class="community-error hidden" data-community-error></p>
      </section>`;

    root.querySelector<HTMLButtonElement>('[data-community-signin]')?.addEventListener('click', () => void this.runtime.signIn());
    root.querySelector<HTMLButtonElement>('[data-community-signout]')?.addEventListener('click', () => void this.runtime.signOut());
    root.querySelector<HTMLButtonElement>('[data-community-provision]')?.addEventListener('click', () => void this.provision());
    root.querySelector<HTMLButtonElement>('[data-community-activate]')?.addEventListener('click', () => void this.runtime.activate());
    root.querySelector<HTMLButtonElement>('[data-community-pause]')?.addEventListener('click', () => void this.runtime.pause());
    root.querySelector<HTMLButtonElement>('[data-community-rotate]')?.addEventListener('click', () => void this.runtime.rotate());
    root.querySelector<HTMLButtonElement>('[data-community-revoke]')?.addEventListener('click', () => {
      if (window.confirm('Revocar este nodo es irreversible. ¿Continuar?')) void this.runtime.revoke();
    });
    root.querySelector<HTMLButtonElement>('[data-community-clear]')?.addEventListener('click', () => void this.runtime.clearRevoked());

    this.unsubscribe?.();
    this.unsubscribe = this.runtime.subscribe((snapshot) => this.update(snapshot));
    void this.runtime.refresh();
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.root = null;
  }

  private async provision(): Promise<void> {
    const root = this.root;
    if (!root) return;
    const label = root.querySelector<HTMLInputElement>('[data-community-label-input]')?.value.trim() ?? '';
    const segmentId = root.querySelector<HTMLInputElement>('[data-community-segment-input]')?.value.trim() ?? '';
    if (!label || !segmentId) {
      const error = root.querySelector<HTMLElement>('[data-community-error]');
      if (error) {
        error.textContent = 'Ingresa el nombre del nodo y el segmento público.';
        error.classList.remove('hidden');
      }
      return;
    }
    await this.runtime.provision({ label, segmentId });
  }

  private update(snapshot: NodeCommunitySnapshot): void {
    const root = this.root;
    if (!root) return;
    const shell = root.querySelector<HTMLElement>('.community-panel');
    if (shell) shell.dataset.communityState = snapshot.identity?.status ?? (snapshot.configured ? 'unregistered' : 'unconfigured');

    const label = statusLabel(snapshot);
    setText(root, '[data-community-status]', `${snapshot.identity?.status === 'active' ? '●' : '○'} ${label}`);
    setText(root, '[data-community-help]', statusHelp(snapshot));
    setText(root, '[data-community-node]', snapshot.identity?.nodeId ?? '—');
    setText(root, '[data-community-label]', snapshot.identity?.label ?? 'sin registrar');
    setText(root, '[data-community-segment]', snapshot.identity?.segmentId ?? '—');
    setText(root, '[data-community-human]', snapshot.human.authenticated ? snapshot.human.email ?? 'conectada' : 'cerrada');
    setText(root, '[data-community-transport]', snapshot.sensorReady ? 'listo' : 'no disponible');

    const hasIdentity = snapshot.identity !== undefined;
    const human = snapshot.human.authenticated;
    const status = snapshot.identity?.status;
    const canAdmin = snapshot.configured && human && !snapshot.busy;

    setVisible(root, '[data-community-enroll]', snapshot.configured && !hasIdentity);
    setVisible(root, '[data-community-signin]', snapshot.configured && !human);
    setVisible(root, '[data-community-signout]', snapshot.configured && human);
    setVisible(root, '[data-community-provision]', canAdmin && !hasIdentity);
    setVisible(root, '[data-community-activate]', canAdmin && (status === 'provisioning' || status === 'paused'));
    setVisible(root, '[data-community-pause]', canAdmin && status === 'active');
    setVisible(root, '[data-community-rotate]', canAdmin && hasIdentity && status !== 'revoked');
    setVisible(root, '[data-community-revoke]', canAdmin && hasIdentity && status !== 'revoked');
    setVisible(root, '[data-community-clear]', !snapshot.busy && status === 'revoked');

    for (const selector of [
      '[data-community-signin]',
      '[data-community-signout]',
      '[data-community-provision]',
      '[data-community-activate]',
      '[data-community-pause]',
      '[data-community-rotate]',
      '[data-community-revoke]',
      '[data-community-clear]',
    ]) setDisabled(root, selector, snapshot.busy);
    setDisabled(root, '[data-community-label-input]', snapshot.busy);
    setDisabled(root, '[data-community-segment-input]', snapshot.busy);

    const error = root.querySelector<HTMLElement>('[data-community-error]');
    if (error) {
      error.textContent = snapshot.error ?? '';
      error.classList.toggle('hidden', snapshot.error === undefined);
    }
  }
}
