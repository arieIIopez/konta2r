import './app.css';
import { toAnonymousRenderEntity } from './spatial/anonymousAvatar';
import type { CalibrationFitResult } from './spatial/calibration';
import {
  evaluateSpatialCapabilities,
  type SpatialCapabilityReport,
} from './spatial/calibrationPolicy';
import {
  metricToCanvas,
  renderSyntheticTwin2D,
  type SyntheticTwinViewport,
} from './spatial/syntheticTwin2d';
import type { EntityType } from './core/types';
import type { SpatialTrackSample } from './spatial/types';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing #app');
const root: HTMLDivElement = app;

const demoCalibration: CalibrationFitResult = {
  imageToGroundH: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  inlierMask: [true, true, true, true, true, true, true, true],
  inlierRatio: 1,
  reprojectionErrorsMeters: [0.09, 0.12, 0.14, 0.16, 0.18, 0.19, 0.21, 0.28],
  reprojectionErrorMedianMeters: 0.16,
  reprojectionErrorP95Meters: 0.28,
  calibrationQuality: 0.94,
  status: 'valid',
};

interface DemoAgent {
  id: string;
  entityType: EntityType;
  x: number;
  y: number;
  heading: number;
  speedMps: number;
  confidence: number;
}

const agents: DemoAgent[] = [
  { id: 'r1', entityType: 'car', x: 2, y: 2.1, heading: 90, speedMps: 8.2, confidence: 0.95 },
  { id: 'r2', entityType: 'car', x: 19, y: -2.2, heading: 270, speedMps: 7.1, confidence: 0.91 },
  { id: 'r3', entityType: 'bus', x: 30, y: 2.2, heading: 90, speedMps: 6.3, confidence: 0.93 },
  { id: 'r4', entityType: 'cyclist', x: 8, y: 6.0, heading: 90, speedMps: 4.6, confidence: 0.94 },
  { id: 'r5', entityType: 'cyclist', x: 27, y: 6.1, heading: 90, speedMps: 5.1, confidence: 0.89 },
  { id: 'r6', entityType: 'pedestrian', x: 13, y: 9.0, heading: 90, speedMps: 1.35, confidence: 0.96 },
  { id: 'r7', entityType: 'pedestrian', x: 25, y: 9.2, heading: 270, speedMps: 1.15, confidence: 0.92 },
  { id: 'r8', entityType: 'motorcyclist', x: 35, y: -2.0, heading: 270, speedMps: 8.8, confidence: 0.88 },
];

let cameraStable = true;
let showSpeed = true;
let lastFrameMs = performance.now();

function capabilityLabel(key: string): string {
  const labels: Record<string, string> = {
    counting: 'Conteo',
    direction: 'Sentido',
    approximate_trajectory: 'Trayectoria aproximada',
    metric_position: 'Posición métrica',
    metric_speed: 'Velocidad métrica',
    advanced_interactions: 'Interacciones avanzadas',
  };
  return labels[key] ?? key;
}

function reasonLabel(reason: string): string {
  const labels: Record<string, string> = {
    camera_moved_recalibration_required: 'La cámara se movió: se requiere recalibración.',
    valid_metric_calibration_required: 'Se requiere una calibración métrica válida.',
    metric_position_not_reliable: 'La posición métrica no tiene calidad suficiente.',
    metric_speed_not_reliable: 'La velocidad métrica no tiene calidad suficiente.',
    advanced_quality_below_threshold: 'La evidencia aún no alcanza el umbral avanzado.',
    metric_speed_quality_below_threshold: 'La calidad combinada es insuficiente para velocidad.',
    metric_position_quality_below_threshold: 'La calidad combinada es insuficiente para posición métrica.',
  };
  return labels[reason] ?? reason.replaceAll('_', ' ');
}

function currentReport(): SpatialCapabilityReport {
  return evaluateSpatialCapabilities({
    calibration: demoCalibration,
    correspondenceCoverage: 0.91,
    trackingQuality: 0.92,
    motionQuality: 0.9,
    cameraStable,
  });
}

function capabilityMarkup(report: SpatialCapabilityReport): string {
  return Object.values(report.decisions).map((item) => {
    const detail = item.enabled
      ? `Calidad ${(item.quality * 100).toFixed(0)}%`
      : reasonLabel(item.reasons[0] ?? 'No disponible');
    return `
      <div class="capability">
        <div><b>${capabilityLabel(item.capability)}</b><small>${detail}</small></div>
        <span class="state ${item.enabled ? 'on' : 'off'}">${item.enabled ? 'activo' : 'bloqueado'}</span>
      </div>`;
  }).join('');
}

function qualityRow(label: string, value: number): string {
  const pct = Math.max(0, Math.min(100, value * 100));
  return `
    <div class="quality-row">
      <span>${label}</span>
      <div class="track"><div class="fill" style="width:${pct.toFixed(0)}%"></div></div>
      <span class="quality-value">${pct.toFixed(0)}</span>
    </div>`;
}

function renderShell(): void {
  const report = currentReport();
  root.innerHTML = `
    <main class="shell">
      <header class="topbar">
        <div class="brand">
          <div class="logo">K2</div>
          <div><h1>Konta2r v2</h1><p>Nodo ciudadano · Synthetic Twin</p></div>
        </div>
        <span class="status-pill">${cameraStable ? '● nodo estable' : '● recalibración requerida'}</span>
      </header>

      <section class="hero-grid">
        <article class="card">
          <div class="card-header">
            <div><h2>Synthetic Twin 2D</h2><p>Reconstrucción anónima. El renderer no recibe video ni atributos visuales.</p></div>
            <span class="status-pill">demo local</span>
          </div>
          <div class="twin-wrap">
            <canvas id="synthetic-twin"></canvas>
            <span class="twin-badge">sin pixels · tracks efímeros</span>
            <div class="legend">
              <span><i></i> avatares abstractos</span>
              <span>posición en plano local métrico</span>
            </div>
          </div>
          <div class="metrics">
            <div class="metric"><strong>8</strong><span>entidades sintéticas</span></div>
            <div class="metric"><strong>0,16 m</strong><span>error mediano</span></div>
            <div class="metric"><strong>0,28 m</strong><span>error p95</span></div>
            <div class="metric"><strong>${cameraStable ? '94' : '0'}%</strong><span>geometría utilizable</span></div>
          </div>
          <div class="actions">
            <button class="action primary" id="toggle-camera">${cameraStable ? 'Simular movimiento de cámara' : 'Restablecer calibración'}</button>
            <button class="action" id="toggle-speed">${showSpeed ? 'Ocultar velocidades' : 'Mostrar velocidades'}</button>
          </div>
        </article>

        <aside class="side-stack">
          <article class="card">
            <div class="card-header"><div><h2>Capacidades habilitadas</h2><p>Las métricas físicas se activan solo si la evidencia geométrica lo permite.</p></div></div>
            <div class="capabilities">${capabilityMarkup(report)}</div>
          </article>

          <article class="card">
            <div class="card-header"><div><h2>Calidad del nodo</h2><p>Componentes separados para no esconder incertidumbre.</p></div></div>
            <div class="quality-block">
              ${qualityRow('Calibración', cameraStable ? 0.94 : 0)}
              ${qualityRow('Cobertura geométrica', 0.91)}
              ${qualityRow('Tracking', 0.92)}
              ${qualityRow('Movimiento', 0.90)}
            </div>
            <p class="notice">${cameraStable
              ? 'La demostración cumple el umbral para posición y velocidad métricas. Las interacciones avanzadas siguen siendo una capacidad que deberá validarse empíricamente.'
              : 'Konta2r detectó deriva del encuadre. El conteo puede continuar, pero las magnitudes físicas quedan bloqueadas hasta recalibrar.'}</p>
          </article>
        </aside>
      </section>

      <p class="footer-note">Prototipo de arquitectura v2 · datos simulados · ningún video se transmite</p>
    </main>`;

  document.querySelector<HTMLButtonElement>('#toggle-camera')?.addEventListener('click', () => {
    cameraStable = !cameraStable;
    renderShell();
    startCanvas();
  });
  document.querySelector<HTMLButtonElement>('#toggle-speed')?.addEventListener('click', () => {
    showSpeed = !showSpeed;
    renderShell();
    startCanvas();
  });
}

function resizeCanvas(canvas: HTMLCanvasElement): void {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

function drawBand(
  ctx: CanvasRenderingContext2D,
  viewport: SyntheticTwinViewport,
  yMin: number,
  yMax: number,
  fill: string,
): void {
  const leftTop = metricToCanvas({ xMeters: -5, yMeters: yMax }, viewport, ctx.canvas.width, ctx.canvas.height);
  const rightBottom = metricToCanvas({ xMeters: 45, yMeters: yMin }, viewport, ctx.canvas.width, ctx.canvas.height);
  ctx.fillStyle = fill;
  ctx.fillRect(leftTop.x, leftTop.y, rightBottom.x - leftTop.x, rightBottom.y - leftTop.y);
}

function drawStreet(ctx: CanvasRenderingContext2D, viewport: SyntheticTwinViewport): void {
  ctx.fillStyle = '#e7ecf2';
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  drawBand(ctx, viewport, -4.5, 4.5, '#5d6672');
  drawBand(ctx, viewport, 4.9, 7.1, '#b9d7ce');
  drawBand(ctx, viewport, 7.5, 11.0, '#d6d9dc');

  const roadCenterA = metricToCanvas({ xMeters: -5, yMeters: 0 }, viewport, ctx.canvas.width, ctx.canvas.height);
  const roadCenterB = metricToCanvas({ xMeters: 45, yMeters: 0 }, viewport, ctx.canvas.width, ctx.canvas.height);
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,.58)';
  ctx.setLineDash([18, 16]);
  ctx.lineWidth = Math.max(2, viewport.pixelsPerMeter * 0.07);
  ctx.beginPath();
  ctx.moveTo(roadCenterA.x, roadCenterA.y);
  ctx.lineTo(roadCenterB.x, roadCenterB.y);
  ctx.stroke();
  ctx.restore();

  const cycleA = metricToCanvas({ xMeters: -5, yMeters: 6 }, viewport, ctx.canvas.width, ctx.canvas.height);
  const cycleB = metricToCanvas({ xMeters: 45, yMeters: 6 }, viewport, ctx.canvas.width, ctx.canvas.height);
  ctx.save();
  ctx.strokeStyle = 'rgba(15,118,110,.45)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cycleA.x, cycleA.y);
  ctx.lineTo(cycleB.x, cycleB.y);
  ctx.stroke();
  ctx.restore();
}

function advanceAgents(dtSeconds: number): void {
  for (const agent of agents) {
    const radians = ((agent.heading - 90) * Math.PI) / 180;
    agent.x += Math.cos(radians) * agent.speedMps * dtSeconds;
    agent.y -= Math.sin(radians) * agent.speedMps * dtSeconds;

    if (agent.x > 43) agent.x = -3;
    if (agent.x < -3) agent.x = 43;
  }
}

function samplesAt(timestampMs: number): SpatialTrackSample[] {
  return agents.map((agent) => ({
    schemaVersion: '2.0',
    sessionId: 'local-demo',
    renderTrackId: agent.id,
    timestampMs,
    entityType: agent.entityType,
    position: { xMeters: agent.x, yMeters: agent.y },
    headingDegrees: agent.heading,
    ...(cameraStable ? { speedMps: agent.speedMps } : {}),
    confidence: agent.confidence,
    calibrationQuality: cameraStable ? 0.94 : 0,
    motionQuality: 0.9,
  }));
}

let animationHandle = 0;
function startCanvas(): void {
  cancelAnimationFrame(animationHandle);
  const canvas = document.querySelector<HTMLCanvasElement>('#synthetic-twin');
  if (!canvas) return;
  const context = canvas.getContext('2d');
  if (!context) return;

  const renderFrame = (now: number): void => {
    resizeCanvas(canvas);
    const dt = Math.min(0.05, Math.max(0, (now - lastFrameMs) / 1000));
    lastFrameMs = now;
    advanceAgents(dt);

    const pixelsPerMeter = Math.max(6, Math.min(canvas.width / 50, canvas.height / 25));
    const viewport: SyntheticTwinViewport = {
      center: { xMeters: 20, yMeters: 3.2 },
      pixelsPerMeter,
    };

    drawStreet(context, viewport);
    const entities = samplesAt(Date.now()).map(toAnonymousRenderEntity);
    renderSyntheticTwin2D(context, entities, viewport, {
      clear: false,
      showHeading: false,
      showSpeed: showSpeed && cameraStable,
      showTrackIds: false,
      foreground: '#142033',
      lowQualityThreshold: 0.55,
    });

    if (!cameraStable) {
      context.save();
      context.fillStyle = 'rgba(127, 29, 29, .14)';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#7f1d1d';
      context.font = `${Math.max(15, canvas.width * 0.018)}px sans-serif`;
      context.fillText('Calibración obsoleta · métricas físicas suspendidas', 22, 34);
      context.restore();
    }

    animationHandle = requestAnimationFrame(renderFrame);
  };

  lastFrameMs = performance.now();
  animationHandle = requestAnimationFrame(renderFrame);
}

renderShell();
startCanvas();
window.addEventListener('resize', startCanvas);
