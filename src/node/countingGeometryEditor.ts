import type { NormalizedDirectedLine, NormalizedPoint2D } from '../geometry/normalized';
import {
  countingLineSideLabels,
  createCountingGeometryConfiguration,
  normalizedVideoPointToViewport,
  viewportPointToNormalizedVideo,
  type CountingGeometryConfiguration,
  type CountingGeometryStore,
} from './countingGeometry';

export interface CountingGeometryEditorSnapshot {
  loaded: boolean;
  editing: boolean;
  dirty: boolean;
  configuration?: CountingGeometryConfiguration;
  draft?: NormalizedDirectedLine;
  error?: string;
}

export interface CountingGeometryEditorOptions {
  store: CountingGeometryStore;
  lineId?: string;
}

type Listener = (snapshot: CountingGeometryEditorSnapshot) => void;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function cloneLine(line: NormalizedDirectedLine): NormalizedDirectedLine {
  return {
    id: line.id,
    a: { ...line.a },
    b: { ...line.b },
    ...(line.labelLeftToRight === undefined ? {} : { labelLeftToRight: line.labelLeftToRight }),
    ...(line.labelRightToLeft === undefined ? {} : { labelRightToLeft: line.labelRightToLeft }),
  };
}

function cloneConfiguration(
  configuration: CountingGeometryConfiguration,
): CountingGeometryConfiguration {
  return {
    ...configuration,
    referenceFrame: { ...configuration.referenceFrame },
    line: cloneLine(configuration.line),
    directionConvention: { ...configuration.directionConvention },
  };
}

function lineDistance(line: NormalizedDirectedLine): number {
  return Math.hypot(line.b.x - line.a.x, line.b.y - line.a.y);
}

function svgElement<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS('http://www.w3.org/2000/svg', tag);
}

/**
 * Touch-first overlay for a single oriented flow-counting line. Pointer
 * coordinates are mapped through the exact CSS `object-fit: cover` transform so
 * normalized geometry always refers to the source camera frame, not the cropped
 * viewport.
 */
export class CountingGeometryEditor {
  private readonly store: CountingGeometryStore;
  private readonly lineId: string;
  private readonly listeners = new Set<Listener>();
  private video: HTMLVideoElement | null = null;
  private overlay: SVGSVGElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private activePointerId: number | null = null;
  private state: CountingGeometryEditorSnapshot = {
    loaded: false,
    editing: false,
    dirty: false,
  };

  constructor(options: CountingGeometryEditorOptions) {
    this.store = options.store;
    this.lineId = options.lineId?.trim() || 'line_primary';
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  snapshot(): CountingGeometryEditorSnapshot {
    return {
      ...this.state,
      ...(this.state.configuration === undefined
        ? {}
        : { configuration: cloneConfiguration(this.state.configuration) }),
      ...(this.state.draft === undefined ? {} : { draft: cloneLine(this.state.draft) }),
    };
  }

  mount(host: HTMLElement, video: HTMLVideoElement): void {
    this.destroyOverlay();
    this.video = video;
    const overlay = svgElement('svg');
    overlay.classList.add('counting-geometry-overlay');
    overlay.setAttribute('aria-label', 'Editor de línea de conteo');
    overlay.setAttribute('role', 'img');
    overlay.addEventListener('pointerdown', this.pointerDown);
    overlay.addEventListener('pointermove', this.pointerMove);
    overlay.addEventListener('pointerup', this.pointerUp);
    overlay.addEventListener('pointercancel', this.pointerCancel);
    host.append(overlay);
    this.overlay = overlay;
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.render());
      this.resizeObserver.observe(host);
    }
    video.addEventListener('loadedmetadata', this.metadataHandler);
    this.render();
  }

  async load(): Promise<void> {
    try {
      const configuration = await this.store.load();
      this.state = {
        loaded: true,
        editing: false,
        dirty: false,
        ...(configuration === undefined
          ? {}
          : {
              configuration,
              draft: cloneLine(configuration.line),
            }),
      };
    } catch (error) {
      this.state = {
        loaded: true,
        editing: false,
        dirty: false,
        error: message(error),
      };
    }
    this.emit();
    this.render();
  }

  setEditing(editing: boolean): void {
    const next: CountingGeometryEditorSnapshot = {
      ...this.state,
      editing,
    };
    delete next.error;
    if (editing && !next.draft && next.configuration) {
      next.draft = cloneLine(next.configuration.line);
    }
    this.state = next;
    this.emit();
    this.render();
  }

  cancelEditing(): void {
    const next: CountingGeometryEditorSnapshot = {
      ...this.state,
      editing: false,
      dirty: false,
    };
    if (this.state.configuration) next.draft = cloneLine(this.state.configuration.line);
    else delete next.draft;
    delete next.error;
    this.state = next;
    this.emit();
    this.render();
  }

  async save(): Promise<CountingGeometryConfiguration> {
    const video = this.requireUsableVideo();
    const draft = this.state.draft;
    if (!draft) throw new Error('Dibuja una línea antes de guardar');
    if (lineDistance(draft) < 0.04) throw new Error('La línea de conteo es demasiado corta');
    try {
      const configuration = createCountingGeometryConfiguration({
        line: draft,
        frameWidth: video.videoWidth,
        frameHeight: video.videoHeight,
        ...(this.state.configuration === undefined
          ? {}
          : { previous: this.state.configuration }),
      });
      await this.store.save(configuration);
      this.state = {
        loaded: true,
        editing: false,
        dirty: false,
        configuration,
        draft: cloneLine(configuration.line),
      };
      this.emit();
      this.render();
      return cloneConfiguration(configuration);
    } catch (error) {
      this.state = { ...this.state, error: message(error) };
      this.emit();
      this.render();
      throw error;
    }
  }

  async clear(): Promise<void> {
    try {
      await this.store.clear();
      this.state = {
        loaded: true,
        editing: false,
        dirty: false,
      };
    } catch (error) {
      this.state = { ...this.state, error: message(error) };
    }
    this.emit();
    this.render();
  }

  destroy(): void {
    this.destroyOverlay();
    this.listeners.clear();
    this.video = null;
  }

  private readonly metadataHandler = (): void => {
    this.render();
  };

  private readonly pointerDown = (event: PointerEvent): void => {
    if (!this.state.editing || this.activePointerId !== null) return;
    const point = this.eventPoint(event);
    if (!point) return;
    this.activePointerId = event.pointerId;
    this.overlay?.setPointerCapture(event.pointerId);
    const draft: NormalizedDirectedLine = {
      id: this.lineId,
      a: point,
      b: { ...point },
      labelLeftToRight: 'A_TO_B',
      labelRightToLeft: 'B_TO_A',
    };
    const next: CountingGeometryEditorSnapshot = {
      ...this.state,
      draft,
      dirty: true,
    };
    delete next.error;
    this.state = next;
    this.emit();
    this.render();
    event.preventDefault();
  };

  private readonly pointerMove = (event: PointerEvent): void => {
    if (!this.state.editing || this.activePointerId !== event.pointerId || !this.state.draft) return;
    const point = this.eventPoint(event);
    if (!point) return;
    this.state = {
      ...this.state,
      draft: {
        ...this.state.draft,
        a: { ...this.state.draft.a },
        b: point,
      },
      dirty: true,
    };
    this.emit();
    this.render();
    event.preventDefault();
  };

  private readonly pointerUp = (event: PointerEvent): void => {
    if (this.activePointerId !== event.pointerId) return;
    this.pointerMove(event);
    this.overlay?.releasePointerCapture(event.pointerId);
    this.activePointerId = null;
    if (this.state.draft && lineDistance(this.state.draft) < 0.04) {
      this.state = {
        ...this.state,
        error: 'La línea es demasiado corta. Arrastra desde un punto A hasta un punto B.',
      };
      this.emit();
      this.render();
    }
    event.preventDefault();
  };

  private readonly pointerCancel = (event: PointerEvent): void => {
    if (this.activePointerId !== event.pointerId) return;
    this.activePointerId = null;
    event.preventDefault();
  };

  private eventPoint(event: PointerEvent): NormalizedPoint2D | undefined {
    const overlay = this.overlay;
    const video = this.video;
    if (!overlay || !this.isLiveVideo(video)) return undefined;
    const rect = overlay.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return undefined;
    return viewportPointToNormalizedVideo({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      sourceWidth: video.videoWidth,
      sourceHeight: video.videoHeight,
      viewportWidth: rect.width,
      viewportHeight: rect.height,
    });
  }

  private requireUsableVideo(): HTMLVideoElement {
    const video = this.video;
    if (!this.isLiveVideo(video)) {
      throw new Error('La cámara debe estar activa antes de guardar la geometría');
    }
    return video;
  }

  private isLiveVideo(video: HTMLVideoElement | null): video is HTMLVideoElement {
    return Boolean(
      video
      && video.srcObject
      && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
      && video.videoWidth > 0
      && video.videoHeight > 0
    );
  }

  private render(): void {
    const overlay = this.overlay;
    const video = this.video;
    if (!overlay) return;
    overlay.replaceChildren();
    overlay.classList.toggle('editing', this.state.editing);
    overlay.style.pointerEvents = this.state.editing ? 'auto' : 'none';
    if (!video || video.videoWidth <= 0 || video.videoHeight <= 0) return;
    const rect = overlay.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    overlay.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);

    const line = this.state.draft ?? this.state.configuration?.line;
    if (!line || lineDistance(line) < 1e-9) return;
    const a = normalizedVideoPointToViewport({
      point: line.a,
      sourceWidth: video.videoWidth,
      sourceHeight: video.videoHeight,
      viewportWidth: rect.width,
      viewportHeight: rect.height,
    });
    const b = normalizedVideoPointToViewport({
      point: line.b,
      sourceWidth: video.videoWidth,
      sourceHeight: video.videoHeight,
      viewportWidth: rect.width,
      viewportHeight: rect.height,
    });

    const defs = svgElement('defs');
    const marker = svgElement('marker');
    marker.setAttribute('id', 'counting-line-arrow');
    marker.setAttribute('markerWidth', '8');
    marker.setAttribute('markerHeight', '8');
    marker.setAttribute('refX', '7');
    marker.setAttribute('refY', '4');
    marker.setAttribute('orient', 'auto');
    const arrow = svgElement('path');
    arrow.setAttribute('d', 'M 0 0 L 8 4 L 0 8 z');
    arrow.setAttribute('class', 'counting-line-arrow');
    marker.append(arrow);
    defs.append(marker);
    overlay.append(defs);

    const visibleLine = svgElement('line');
    visibleLine.setAttribute('x1', String(a.x));
    visibleLine.setAttribute('y1', String(a.y));
    visibleLine.setAttribute('x2', String(b.x));
    visibleLine.setAttribute('y2', String(b.y));
    visibleLine.setAttribute('class', 'counting-line');
    visibleLine.setAttribute('marker-end', 'url(#counting-line-arrow)');
    overlay.append(visibleLine);

    for (const [point, label] of [[a, 'inicio'], [b, 'fin']] as const) {
      const circle = svgElement('circle');
      circle.setAttribute('cx', String(point.x));
      circle.setAttribute('cy', String(point.y));
      circle.setAttribute('r', '6');
      circle.setAttribute('class', `counting-line-handle counting-line-${label}`);
      overlay.append(circle);
    }

    if (lineDistance(line) >= 0.04) {
      const sides = countingLineSideLabels(line);
      this.renderSideLabel(overlay, video, rect, sides.sideA, 'A');
      this.renderSideLabel(overlay, video, rect, sides.sideB, 'B');
    }
  }

  private renderSideLabel(
    overlay: SVGSVGElement,
    video: HTMLVideoElement,
    rect: DOMRect,
    point: NormalizedPoint2D,
    label: 'A' | 'B',
  ): void {
    const viewport = normalizedVideoPointToViewport({
      point,
      sourceWidth: video.videoWidth,
      sourceHeight: video.videoHeight,
      viewportWidth: rect.width,
      viewportHeight: rect.height,
    });
    const group = svgElement('g');
    group.setAttribute('class', `counting-side-label side-${label.toLowerCase()}`);
    const circle = svgElement('circle');
    circle.setAttribute('cx', String(viewport.x));
    circle.setAttribute('cy', String(viewport.y));
    circle.setAttribute('r', '13');
    const text = svgElement('text');
    text.setAttribute('x', String(viewport.x));
    text.setAttribute('y', String(viewport.y + 4));
    text.setAttribute('text-anchor', 'middle');
    text.textContent = label;
    group.append(circle, text);
    overlay.append(group);
  }

  private emit(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }

  private destroyOverlay(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.video) this.video.removeEventListener('loadedmetadata', this.metadataHandler);
    if (this.overlay) {
      this.overlay.removeEventListener('pointerdown', this.pointerDown);
      this.overlay.removeEventListener('pointermove', this.pointerMove);
      this.overlay.removeEventListener('pointerup', this.pointerUp);
      this.overlay.removeEventListener('pointercancel', this.pointerCancel);
      this.overlay.remove();
    }
    this.overlay = null;
    this.activePointerId = null;
  }
}
