import { describe, expect, it } from 'vitest';
import {
  serializePilotCaptureRecord,
  validatePilotCaptureRecord,
  type PilotCaptureRecord,
} from '../../src/detection/pilotCaptureRecord';
import { parsePilotCaptureRecordJson } from '../../src/detection/pilotCaptureRecordParser';

function record(overrides: Partial<PilotCaptureRecord> = {}): PilotCaptureRecord {
  return {
    schemaVersion: '1',
    recordType: 'konta2r_pilot_capture',
    captureId: 'cap-001',
    siteId: 'site-001',
    plannedSplit: 'development',
    startedAtIso: '2026-08-31T17:00:00.000Z',
    durationSeconds: 900,
    scene: {
      sceneType: 'mixed_traffic',
      lighting: 'day',
      viewAngle: 'medium_oblique',
      throughGlass: true,
      reflections: 'mixed',
      sceneOcclusion: 'mixed',
      cameraStability: 'good',
    },
    camera: {
      width: 960,
      height: 540,
      frameRate: 24,
      orientation: 'landscape',
      mount: 'fixed',
      facingMode: 'environment',
    },
    device: {
      profile: 'balanced',
      hardwareConcurrency: 8,
      deviceMemoryGiB: 6,
      webgpu: true,
      powerSource: 'mains',
      userAgent: 'test-browser',
    },
    notes: ['Vidrio limpio al iniciar la captura.'],
    ...overrides,
  };
}

describe('pilot capture record', () => {
  it('accepts and serializes a complete privacy-preserving capture record', () => {
    const value = record({ plannedSplit: 'validation' });
    expect(() => validatePilotCaptureRecord(value)).not.toThrow();
    const parsed = JSON.parse(serializePilotCaptureRecord(value));
    expect(parsed.plannedSplit).toBe('validation');
    expect(parsed.camera.width).toBe(960);
    expect(parsed).not.toHaveProperty('latitude');
    expect(parsed.camera).not.toHaveProperty('deviceId');
  });

  it('rejects address-like and coordinate-like opaque identifiers', () => {
    expect(() => validatePilotCaptureRecord(record({ siteId: 'Avenida Siempre Viva 123' })))
      .toThrow('opaque');
    expect(() => validatePilotCaptureRecord(record({ siteId: '33.4489_70.6693' })))
      .toThrow('precise coordinates');
  });

  it('rejects invalid capture duration and frame rate', () => {
    expect(() => validatePilotCaptureRecord(record({ durationSeconds: 0 })))
      .toThrow('durationSeconds');
    const bad = record();
    bad.camera.frameRate = Number.NaN;
    expect(() => validatePilotCaptureRecord(bad)).toThrow('camera frameRate');
  });

  it('parses untrusted JSON and drops unexpected location/device fields', () => {
    const input = record({ plannedSplit: 'held_out_test' }) as PilotCaptureRecord & Record<string, unknown>;
    const raw = JSON.stringify({
      ...input,
      latitude: -33.4,
      longitude: -70.6,
      camera: { ...input.camera, deviceId: 'stable-camera-fingerprint' },
      unexpected: true,
    });
    const parsed = parsePilotCaptureRecordJson(raw);
    expect(parsed.plannedSplit).toBe('held_out_test');
    expect('latitude' in parsed).toBe(false);
    expect('deviceId' in parsed.camera).toBe(false);
    expect('unexpected' in parsed).toBe(false);
  });

  it('rejects unsupported enum values during defensive parsing', () => {
    const raw = JSON.parse(serializePilotCaptureRecord(record()));
    raw.scene.lighting = 'sunset_magic';
    expect(() => parsePilotCaptureRecordJson(JSON.stringify(raw))).toThrow('Unsupported lighting');
  });
});
