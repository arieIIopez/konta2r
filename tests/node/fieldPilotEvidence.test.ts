import { describe, expect, it } from 'vitest';
import {
  FieldPilotEvidenceRecorder,
  assertFieldPilotEvidenceSafe,
  buildFieldPilotEvidenceReport,
  type FieldPilotEvidenceStore,
  type FieldPilotRuntimeSample,
  type FieldPilotSessionRecord,
} from '../../src/node/fieldPilotEvidence';
import type { NodePilotPipelineSnapshot } from '../../src/node/pilotPipeline';
import type { NodeRuntimeSnapshot } from '../../src/node/runtimeController';

class MemoryFieldPilotStore implements FieldPilotEvidenceStore {
  readonly sessions = new Map<string, FieldPilotSessionRecord>();
  readonly samples = new Map<string, FieldPilotRuntimeSample>();

  async putSession(session: FieldPilotSessionRecord): Promise<void> {
    this.sessions.set(session.sessionId, structuredClone(session));
  }

  async getSession(sessionId: string): Promise<FieldPilotSessionRecord | undefined> {
    const session = this.sessions.get(sessionId);
    return session ? structuredClone(session) : undefined;
  }

  async listSessions(limit = 20): Promise<FieldPilotSessionRecord[]> {
    return [...this.sessions.values()]
      .sort((a, b) => Date.parse(b.startedAtIso) - Date.parse(a.startedAtIso))
      .slice(0, limit)
      .map((session) => structuredClone(session));
  }

  async putSample(sample: FieldPilotRuntimeSample): Promise<void> {
    this.samples.set(sample.id, structuredClone(sample));
  }

  async listSamples(sessionId: string): Promise<FieldPilotRuntimeSample[]> {
    return [...this.samples.values()]
      .filter((sample) => sample.sessionId === sessionId)
      .sort((a, b) => a.sequence - b.sequence)
      .map((sample) => structuredClone(sample));
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
    for (const [id, sample] of this.samples) {
      if (sample.sessionId === sessionId) this.samples.delete(id);
    }
  }
}

function runtime(
  running: boolean,
  elapsedMs: number,
  profile: NodeRuntimeSnapshot['profile'] = 'eco',
  error?: string,
): NodeRuntimeSnapshot {
  return {
    running,
    busy: false,
    profile,
    hints: {
      hardwareConcurrency: 4,
      deviceMemoryGiB: 3,
      webgpu: false,
    },
    camera: running
      ? { active: true, width: 640, height: 360, frameRate: 15 }
      : { active: false },
    wakeLock: { supported: true, active: running },
    storage: null,
    health: {
      sampleCount: running ? 30 : 31,
      observedFps: 2.4,
      inferenceFpsP50: 2.45,
      processingLatencyP95Ms: 280,
      droppedFrameRatio: 0.04,
      loadPressure: 'nominal',
      latencyDriftRatio: 0.08,
    },
    continuity: {
      state: running ? 'active' : 'stopped',
      elapsedMs,
      activeMs: Math.max(0, elapsedMs - 1_000),
      uptimeRatio: elapsedMs === 0 ? 1 : 0.97,
      gapCount: elapsedMs === 0 ? 0 : 1,
      longestGapMs: elapsedMs === 0 ? 0 : 1_000,
    },
    online: true,
    secureContext: true,
    ...(error === undefined ? {} : { error }),
  } as NodeRuntimeSnapshot;
}

function pilot(state: NodePilotPipelineSnapshot['state'] = 'ready'): NodePilotPipelineSnapshot {
  return {
    state,
    displayName: 'NanoDet piloto',
    candidateId: 'opencv-nanodet-m-plus-1.5x-416-2022nov',
    modelSha256: 'a'.repeat(64),
    artifactSource: 'cache',
    cachePersisted: true,
    backend: 'wasm',
  };
}

describe('field pilot evidence recorder', () => {
  it('starts on node run, samples periodically/state changes, and finalizes on stop', async () => {
    const store = new MemoryFieldPilotStore();
    let now = 1_800_000_000_000;
    const recorder = new FieldPilotEvidenceRecorder(store, {
      softwareVersion: '2.0.0-alpha.1',
      sampleIntervalMs: 30_000,
      nowEpochMs: () => now,
      createSessionId: () => 'field_test01',
    });
    await recorder.initialize();

    await recorder.observe(runtime(true, 0), pilot('loading'));
    now += 1_000;
    await recorder.observe(runtime(true, 1_000), pilot('loading'), {
      detections: 4,
      fusedEntities: 3,
      confirmedTracks: 2,
    });
    now += 1_000;
    await recorder.observe(runtime(true, 2_000, 'balanced'), pilot(), {
      detections: 5,
      fusedEntities: 4,
      confirmedTracks: 3,
    });
    now += 31_000;
    await recorder.observe(runtime(true, 33_000, 'balanced'), pilot(), {
      detections: 6,
      fusedEntities: 5,
      confirmedTracks: 4,
    });
    now += 1_000;
    await recorder.observe(runtime(false, 34_000, 'balanced'), pilot('ready'));

    const session = await store.getSession('field_test01');
    const samples = await store.listSamples('field_test01');
    expect(session?.status).toBe('completed');
    expect(session?.softwareVersion).toBe('2.0.0-alpha.1');
    expect(session?.detector?.modelSha256).toBe('a'.repeat(64));
    expect(samples.map((sample) => sample.sequence)).toEqual([0, 1, 2, 3]);
    expect(samples[1]?.profile).toBe('balanced');
    expect(samples[2]?.semantic?.detections).toBe(6);
    expect(samples[3]?.camera.active).toBe(false);
  });

  it('marks stale active sessions interrupted on startup recovery', async () => {
    const store = new MemoryFieldPilotStore();
    await store.putSession({
      schemaVersion: '1.0',
      recordType: 'konta2r_field_pilot_session',
      sessionId: 'field_stale',
      softwareVersion: '2.0.0-alpha.1',
      status: 'active',
      startedAtIso: '2027-01-15T10:00:00.000Z',
      sampleIntervalMs: 30_000,
      initialProfile: 'eco',
      deviceCapabilities: { hardwareConcurrency: 4, webgpu: false },
      secureContext: true,
    });
    const recorder = new FieldPilotEvidenceRecorder(store, {
      softwareVersion: '2.0.0-alpha.1',
      nowEpochMs: () => Date.parse('2027-01-15T10:10:00.000Z'),
    });

    await recorder.initialize();

    expect((await store.getSession('field_stale'))?.status).toBe('interrupted');
    expect((await store.getSession('field_stale'))?.endedAtIso).toBe('2027-01-15T10:10:00.000Z');
  });

  it('uses runtime_error status when the node stops with an operational error', async () => {
    const store = new MemoryFieldPilotStore();
    let now = 1_800_000_000_000;
    const recorder = new FieldPilotEvidenceRecorder(store, {
      softwareVersion: '2.0.0-alpha.1',
      nowEpochMs: () => now,
      createSessionId: () => 'field_error',
    });
    await recorder.initialize();
    await recorder.observe(runtime(true, 0), pilot());
    now += 10_000;
    await recorder.observe(runtime(false, 10_000, 'eco', 'camera ended unexpectedly'), pilot('error'));

    expect((await store.getSession('field_error'))?.status).toBe('runtime_error');
  });

  it('exports performance evidence with explicit privacy and interpretation boundaries', async () => {
    const session: FieldPilotSessionRecord = {
      schemaVersion: '1.0',
      recordType: 'konta2r_field_pilot_session',
      sessionId: 'field_export',
      softwareVersion: '2.0.0-alpha.1',
      status: 'completed',
      startedAtIso: '2027-01-15T10:00:00.000Z',
      endedAtIso: '2027-01-15T10:01:00.000Z',
      sampleIntervalMs: 30_000,
      initialProfile: 'eco',
      deviceCapabilities: { hardwareConcurrency: 4, webgpu: false },
      secureContext: true,
      detector: {
        displayName: 'NanoDet piloto',
        modelSha256: 'a'.repeat(64),
        backend: 'wasm',
      },
    };
    const samples: FieldPilotRuntimeSample[] = [
      {
        id: 'field_export:0',
        sessionId: 'field_export',
        sequence: 0,
        observedAtIso: '2027-01-15T10:00:30.000Z',
        elapsedMs: 30_000,
        profile: 'eco',
        online: true,
        camera: { active: true, width: 640, height: 360 },
        health: {
          sampleCount: 30,
          observedFps: 2.4,
          inferenceFpsP50: 2.45,
          processingLatencyP95Ms: 280,
          droppedFrameRatio: 0.04,
          latencyDriftRatio: 0.08,
          loadPressure: 'nominal',
        },
        continuity: { uptimeRatio: 0.98, gapCount: 0, longestGapMs: 0 },
        pilot: { state: 'ready', backend: 'wasm' },
        semantic: { detections: 5, fusedEntities: 4, confirmedTracks: 3 },
      },
    ];

    const report = buildFieldPilotEvidenceReport(session, samples, Date.parse('2027-01-15T10:02:00.000Z'));
    expect(report.summary.durationMs).toBe(60_000);
    expect(report.summary.observedFpsWindowP50).toBe(2.4);
    expect(report.privacy.containsImages).toBe(false);
    expect(report.privacy.containsTrackIdentifiers).toBe(false);
    expect(report.interpretation.groundTruthAccuracyClaim).toBe(false);
    expect(() => assertFieldPilotEvidenceSafe(report)).not.toThrow();
    const json = JSON.stringify(report);
    expect(json).not.toContain('trackId');
    expect(json).not.toContain('bbox');
    expect(json).not.toContain('communityNodeId');
  });
});
