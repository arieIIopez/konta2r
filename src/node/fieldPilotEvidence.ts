import type { NodePilotPipelineSnapshot } from './pilotPipeline';
import type { NodeRuntimeSnapshot } from './runtimeController';

export interface FieldPilotSemanticSnapshot {
  detections: number;
  fusedEntities: number;
  confirmedTracks: number;
}

export type FieldPilotSessionStatus = 'active' | 'completed' | 'runtime_error' | 'interrupted';

export interface FieldPilotDetectorIdentity {
  displayName: string;
  candidateId?: string;
  modelSha256?: string;
  artifactSource?: 'cache' | 'network';
  cachePersisted?: boolean;
  backend?: NodePilotPipelineSnapshot['backend'];
}

export interface FieldPilotSessionRecord {
  schemaVersion: '1.0';
  recordType: 'konta2r_field_pilot_session';
  sessionId: string;
  softwareVersion: string;
  status: FieldPilotSessionStatus;
  startedAtIso: string;
  endedAtIso?: string;
  sampleIntervalMs: number;
  initialProfile: NodeRuntimeSnapshot['profile'];
  deviceCapabilities: {
    hardwareConcurrency: number;
    deviceMemoryGiB?: number;
    webgpu: boolean;
  };
  secureContext: boolean;
  detector?: FieldPilotDetectorIdentity;
}

export interface FieldPilotRuntimeSample {
  id: string;
  sessionId: string;
  sequence: number;
  observedAtIso: string;
  elapsedMs: number;
  profile: NodeRuntimeSnapshot['profile'];
  online: boolean;
  camera: {
    active: boolean;
    width?: number;
    height?: number;
    frameRate?: number;
  };
  health: {
    sampleCount: number;
    observedFps: number;
    inferenceFpsP50: number;
    processingLatencyP95Ms: number;
    droppedFrameRatio: number;
    latencyDriftRatio: number;
    loadPressure: NodeRuntimeSnapshot['health']['loadPressure'];
  };
  continuity: {
    uptimeRatio: number;
    gapCount: number;
    longestGapMs: number;
  };
  pilot: {
    state: NodePilotPipelineSnapshot['state'];
    backend?: NodePilotPipelineSnapshot['backend'];
    error?: string;
  };
  semantic?: FieldPilotSemanticSnapshot;
}

export interface FieldPilotEvidenceStore {
  putSession(session: FieldPilotSessionRecord): Promise<void>;
  getSession(sessionId: string): Promise<FieldPilotSessionRecord | undefined>;
  listSessions(limit?: number): Promise<FieldPilotSessionRecord[]>;
  putSample(sample: FieldPilotRuntimeSample): Promise<void>;
  listSamples(sessionId: string): Promise<FieldPilotRuntimeSample[]>;
  deleteSession(sessionId: string): Promise<void>;
}

export interface FieldPilotEvidenceSummary {
  durationMs: number;
  sampleCount: number;
  profilesUsed: NodeRuntimeSnapshot['profile'][];
  backendsObserved: string[];
  finalUptimeRatio: number;
  finalGapCount: number;
  loadPressureSamples: Record<NodeRuntimeSnapshot['health']['loadPressure'], number>;
  observedFpsWindowP50: number;
  inferenceCadenceP50WindowP50: number;
  latencyP95WindowP50Ms: number;
  latencyP95WindowP95Ms: number;
  droppedFrameRatioWindowP50: number;
  droppedFrameRatioWindowP95: number;
  semanticSamples: number;
}

export interface FieldPilotEvidenceReport {
  schemaVersion: '1.0';
  recordType: 'konta2r_field_pilot_evidence';
  exportedAtIso: string;
  session: FieldPilotSessionRecord;
  summary: FieldPilotEvidenceSummary;
  samples: FieldPilotRuntimeSample[];
  privacy: {
    containsImages: false;
    containsFrames: false;
    containsBoundingBoxes: false;
    containsTrackIdentifiers: false;
    containsCommunityNodeIdentity: false;
    containsCredentials: false;
  };
  interpretation: {
    performanceEvidenceOnly: true;
    groundTruthAccuracyClaim: false;
    productionSelectionClaim: false;
  };
}

export interface FieldPilotEvidenceRecorderOptions {
  softwareVersion: string;
  sampleIntervalMs?: number;
  nowEpochMs?: () => number;
  createSessionId?: () => string;
}

const FORBIDDEN_EXPORT_KEYS = new Set([
  'trackId',
  'eventId',
  'crossingPoint',
  'bbox',
  'imageData',
  'frameData',
  'credential',
  'accessToken',
  'nodeCredential',
  'communityNodeId',
]);

function normalizedEpoch(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid field-pilot clock');
  return value;
}

function normalizedInterval(value: number): number {
  if (!Number.isFinite(value)) throw new Error('Field-pilot sample interval must be finite');
  return Math.max(5_000, Math.floor(value));
}

function clampNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index] ?? 0;
}

function newSessionId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return `field_${uuid ?? Math.random().toString(36).slice(2)}`;
}

function detectorIdentity(pilot: NodePilotPipelineSnapshot): FieldPilotDetectorIdentity {
  return {
    displayName: pilot.displayName,
    ...(pilot.candidateId === undefined ? {} : { candidateId: pilot.candidateId }),
    ...(pilot.modelSha256 === undefined ? {} : { modelSha256: pilot.modelSha256 }),
    ...(pilot.artifactSource === undefined ? {} : { artifactSource: pilot.artifactSource }),
    ...(pilot.cachePersisted === undefined ? {} : { cachePersisted: pilot.cachePersisted }),
    ...(pilot.backend === undefined ? {} : { backend: pilot.backend }),
  };
}

function sampleSignature(runtime: NodeRuntimeSnapshot, pilot: NodePilotPipelineSnapshot): string {
  return [
    runtime.profile,
    runtime.online ? 'online' : 'offline',
    runtime.camera.active ? 'camera' : 'no-camera',
    runtime.health.loadPressure,
    pilot.state,
    pilot.backend ?? 'no-backend',
    pilot.error ?? '',
  ].join('|');
}

function runtimeSample(
  sessionId: string,
  sequence: number,
  runtime: NodeRuntimeSnapshot,
  pilot: NodePilotPipelineSnapshot,
  semantic: FieldPilotSemanticSnapshot | undefined,
  nowEpochMs: number,
): FieldPilotRuntimeSample {
  return {
    id: `${sessionId}:${sequence}`,
    sessionId,
    sequence,
    observedAtIso: new Date(nowEpochMs).toISOString(),
    elapsedMs: Math.round(clampNonNegative(runtime.continuity.elapsedMs)),
    profile: runtime.profile,
    online: runtime.online,
    camera: {
      active: runtime.camera.active,
      ...(runtime.camera.width === undefined ? {} : { width: runtime.camera.width }),
      ...(runtime.camera.height === undefined ? {} : { height: runtime.camera.height }),
      ...(runtime.camera.frameRate === undefined ? {} : { frameRate: runtime.camera.frameRate }),
    },
    health: {
      sampleCount: Math.max(0, Math.floor(runtime.health.sampleCount)),
      observedFps: clampNonNegative(runtime.health.observedFps),
      inferenceFpsP50: clampNonNegative(runtime.health.inferenceFpsP50),
      processingLatencyP95Ms: clampNonNegative(runtime.health.processingLatencyP95Ms),
      droppedFrameRatio: clamp01(runtime.health.droppedFrameRatio),
      latencyDriftRatio: clampNonNegative(runtime.health.latencyDriftRatio),
      loadPressure: runtime.health.loadPressure,
    },
    continuity: {
      uptimeRatio: clamp01(runtime.continuity.uptimeRatio),
      gapCount: Math.max(0, Math.floor(runtime.continuity.gapCount)),
      longestGapMs: Math.round(clampNonNegative(runtime.continuity.longestGapMs)),
    },
    pilot: {
      state: pilot.state,
      ...(pilot.backend === undefined ? {} : { backend: pilot.backend }),
      ...(pilot.error === undefined ? {} : { error: pilot.error }),
    },
    ...(semantic === undefined
      ? {}
      : {
          semantic: {
            detections: Math.max(0, Math.floor(semantic.detections)),
            fusedEntities: Math.max(0, Math.floor(semantic.fusedEntities)),
            confirmedTracks: Math.max(0, Math.floor(semantic.confirmedTracks)),
          },
        }),
  };
}

export function summarizeFieldPilotEvidence(
  session: FieldPilotSessionRecord,
  samples: readonly FieldPilotRuntimeSample[],
): FieldPilotEvidenceSummary {
  const finalSample = samples.at(-1);
  const startMs = Date.parse(session.startedAtIso);
  const endMs = session.endedAtIso ? Date.parse(session.endedAtIso) : Date.now();
  const durationMs = Number.isFinite(startMs) && Number.isFinite(endMs)
    ? Math.max(0, endMs - startMs)
    : finalSample?.elapsedMs ?? 0;
  const profilesUsed = [...new Set(samples.map((sample) => sample.profile))];
  const backendsObserved = [...new Set(samples
    .map((sample) => sample.pilot.backend)
    .filter((value): value is NonNullable<typeof value> => value !== undefined))];
  const loadPressureSamples: FieldPilotEvidenceSummary['loadPressureSamples'] = {
    unknown: 0,
    nominal: 0,
    elevated: 0,
    critical: 0,
  };
  for (const sample of samples) loadPressureSamples[sample.health.loadPressure] += 1;
  const usable = samples.filter((sample) => sample.health.sampleCount > 0);

  return {
    durationMs,
    sampleCount: samples.length,
    profilesUsed,
    backendsObserved,
    finalUptimeRatio: finalSample?.continuity.uptimeRatio ?? 0,
    finalGapCount: finalSample?.continuity.gapCount ?? 0,
    loadPressureSamples,
    observedFpsWindowP50: percentile(usable.map((sample) => sample.health.observedFps), 0.5),
    inferenceCadenceP50WindowP50: percentile(usable.map((sample) => sample.health.inferenceFpsP50), 0.5),
    latencyP95WindowP50Ms: percentile(usable.map((sample) => sample.health.processingLatencyP95Ms), 0.5),
    latencyP95WindowP95Ms: percentile(usable.map((sample) => sample.health.processingLatencyP95Ms), 0.95),
    droppedFrameRatioWindowP50: percentile(usable.map((sample) => sample.health.droppedFrameRatio), 0.5),
    droppedFrameRatioWindowP95: percentile(usable.map((sample) => sample.health.droppedFrameRatio), 0.95),
    semanticSamples: samples.filter((sample) => sample.semantic !== undefined).length,
  };
}

export function assertFieldPilotEvidenceSafe(report: FieldPilotEvidenceReport): void {
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const child of value) visit(child);
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_EXPORT_KEYS.has(key)) throw new Error(`Unsafe field-pilot export key: ${key}`);
      visit(child);
    }
  };
  visit(report);
}

export function buildFieldPilotEvidenceReport(
  session: FieldPilotSessionRecord,
  samples: FieldPilotRuntimeSample[],
  exportedAtEpochMs = Date.now(),
): FieldPilotEvidenceReport {
  const report: FieldPilotEvidenceReport = {
    schemaVersion: '1.0',
    recordType: 'konta2r_field_pilot_evidence',
    exportedAtIso: new Date(normalizedEpoch(exportedAtEpochMs)).toISOString(),
    session: structuredClone(session),
    summary: summarizeFieldPilotEvidence(session, samples),
    samples: samples.map((sample) => structuredClone(sample)),
    privacy: {
      containsImages: false,
      containsFrames: false,
      containsBoundingBoxes: false,
      containsTrackIdentifiers: false,
      containsCommunityNodeIdentity: false,
      containsCredentials: false,
    },
    interpretation: {
      performanceEvidenceOnly: true,
      groundTruthAccuracyClaim: false,
      productionSelectionClaim: false,
    },
  };
  assertFieldPilotEvidenceSafe(report);
  return report;
}

export class FieldPilotEvidenceRecorder {
  private readonly store: FieldPilotEvidenceStore;
  private readonly softwareVersion: string;
  private readonly sampleIntervalMs: number;
  private readonly nowEpochMs: () => number;
  private readonly createSessionId: () => string;
  private activeSession: FieldPilotSessionRecord | null = null;
  private lastSessionId: string | null = null;
  private lastSampleElapsedMs = Number.NEGATIVE_INFINITY;
  private lastSignature = '';
  private sequence = 0;
  private tail: Promise<void> = Promise.resolve();

  constructor(store: FieldPilotEvidenceStore, options: FieldPilotEvidenceRecorderOptions) {
    this.store = store;
    this.softwareVersion = options.softwareVersion.trim();
    this.sampleIntervalMs = normalizedInterval(options.sampleIntervalMs ?? 30_000);
    this.nowEpochMs = options.nowEpochMs ?? Date.now;
    this.createSessionId = options.createSessionId ?? newSessionId;
    if (!this.softwareVersion) throw new Error('Field-pilot softwareVersion is required');
  }

  initialize(): Promise<void> {
    return this.serialize(async () => {
      const sessions = await this.store.listSessions(100);
      const now = normalizedEpoch(this.nowEpochMs());
      for (const session of sessions) {
        if (session.status !== 'active') continue;
        await this.store.putSession({
          ...session,
          status: 'interrupted',
          endedAtIso: new Date(now).toISOString(),
        });
      }
      this.lastSessionId = sessions[0]?.sessionId ?? null;
    });
  }

  observe(
    runtime: NodeRuntimeSnapshot,
    pilot: NodePilotPipelineSnapshot,
    semantic?: FieldPilotSemanticSnapshot,
  ): Promise<void> {
    return this.serialize(() => this.observeInternal(runtime, pilot, semantic));
  }

  interruptActive(): Promise<void> {
    return this.serialize(async () => {
      if (!this.activeSession) return;
      const now = normalizedEpoch(this.nowEpochMs());
      await this.finalize('interrupted', now);
    });
  }

  async exportCurrentOrLatest(): Promise<FieldPilotEvidenceReport | undefined> {
    await this.tail;
    const sessionId = this.activeSession?.sessionId ?? this.lastSessionId;
    if (!sessionId) return undefined;
    const [session, samples] = await Promise.all([
      this.store.getSession(sessionId),
      this.store.listSamples(sessionId),
    ]);
    if (!session) return undefined;
    return buildFieldPilotEvidenceReport(session, samples, normalizedEpoch(this.nowEpochMs()));
  }

  private async observeInternal(
    runtime: NodeRuntimeSnapshot,
    pilot: NodePilotPipelineSnapshot,
    semantic: FieldPilotSemanticSnapshot | undefined,
  ): Promise<void> {
    const now = normalizedEpoch(this.nowEpochMs());
    if (!this.activeSession && runtime.running) {
      const sessionId = this.createSessionId();
      const session: FieldPilotSessionRecord = {
        schemaVersion: '1.0',
        recordType: 'konta2r_field_pilot_session',
        sessionId,
        softwareVersion: this.softwareVersion,
        status: 'active',
        startedAtIso: new Date(now).toISOString(),
        sampleIntervalMs: this.sampleIntervalMs,
        initialProfile: runtime.profile,
        deviceCapabilities: {
          hardwareConcurrency: runtime.hints.hardwareConcurrency,
          ...(runtime.hints.deviceMemoryGiB === undefined
            ? {}
            : { deviceMemoryGiB: runtime.hints.deviceMemoryGiB }),
          webgpu: runtime.hints.webgpu,
        },
        secureContext: runtime.secureContext,
        detector: detectorIdentity(pilot),
      };
      this.activeSession = session;
      this.lastSessionId = sessionId;
      this.sequence = 0;
      this.lastSampleElapsedMs = Number.NEGATIVE_INFINITY;
      this.lastSignature = '';
      await this.store.putSession(session);
      await this.persistSample(runtime, pilot, semantic, now, true);
      return;
    }

    if (!this.activeSession) return;

    if (!runtime.running) {
      await this.persistSample(runtime, pilot, semantic, now, true);
      await this.finalize(runtime.error ? 'runtime_error' : 'completed', now);
      return;
    }

    const detector = detectorIdentity(pilot);
    if (JSON.stringify(this.activeSession.detector) !== JSON.stringify(detector)) {
      this.activeSession = { ...this.activeSession, detector };
      await this.store.putSession(this.activeSession);
    }
    await this.persistSample(runtime, pilot, semantic, now, false);
  }

  private async persistSample(
    runtime: NodeRuntimeSnapshot,
    pilot: NodePilotPipelineSnapshot,
    semantic: FieldPilotSemanticSnapshot | undefined,
    now: number,
    force: boolean,
  ): Promise<void> {
    const session = this.activeSession;
    if (!session) return;
    const elapsed = clampNonNegative(runtime.continuity.elapsedMs);
    const signature = sampleSignature(runtime, pilot);
    const due = elapsed - this.lastSampleElapsedMs >= this.sampleIntervalMs;
    const changed = signature !== this.lastSignature;
    if (!force && !due && !changed) return;

    const sample = runtimeSample(session.sessionId, this.sequence, runtime, pilot, semantic, now);
    await this.store.putSample(sample);
    this.sequence += 1;
    this.lastSampleElapsedMs = elapsed;
    this.lastSignature = signature;
  }

  private async finalize(status: Exclude<FieldPilotSessionStatus, 'active'>, now: number): Promise<void> {
    const session = this.activeSession;
    if (!session) return;
    const finalSession: FieldPilotSessionRecord = {
      ...session,
      status,
      endedAtIso: new Date(now).toISOString(),
    };
    await this.store.putSession(finalSession);
    this.lastSessionId = session.sessionId;
    this.activeSession = null;
    this.sequence = 0;
    this.lastSampleElapsedMs = Number.NEGATIVE_INFINITY;
    this.lastSignature = '';
  }

  private serialize(operation: () => Promise<void>): Promise<void> {
    const task = this.tail.then(operation, operation);
    this.tail = task.then(() => undefined, () => undefined);
    return task;
  }
}
