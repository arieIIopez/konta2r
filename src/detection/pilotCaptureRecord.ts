import type {
  CorpusLighting,
  CorpusSceneType,
  CorpusSplit,
  CorpusViewAngle,
} from './corpusManifest';
import type { NodePerformanceProfile } from '../node/deviceProfile';

export type CaptureOrientation = 'landscape' | 'portrait' | 'square' | 'unknown';
export type CaptureMount = 'fixed' | 'temporary_fixed' | 'handheld' | 'unknown';
export type CaptureConditionRating = 'good' | 'mixed' | 'poor' | 'unknown';
export type CapturePowerSource = 'mains' | 'battery' | 'unknown';

export interface PilotCaptureRecord {
  schemaVersion: '1';
  recordType: 'konta2r_pilot_capture';
  captureId: string;
  siteId: string;
  plannedSplit: CorpusSplit;
  startedAtIso: string;
  durationSeconds: number;
  scene: {
    sceneType: CorpusSceneType;
    lighting: CorpusLighting;
    viewAngle: CorpusViewAngle;
    throughGlass: boolean;
    reflections: CaptureConditionRating;
    sceneOcclusion: CaptureConditionRating;
    cameraStability: CaptureConditionRating;
  };
  camera: {
    width: number;
    height: number;
    frameRate: number;
    orientation: CaptureOrientation;
    mount: CaptureMount;
    facingMode?: string;
  };
  device: {
    profile: NodePerformanceProfile;
    hardwareConcurrency: number;
    deviceMemoryGiB?: number;
    webgpu: boolean;
    powerSource: CapturePowerSource;
    userAgent?: string;
  };
  notes?: string[];
}

const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const COORDINATE_PAIR = /-?\d{1,2}(?:[._]\d{4,})[-_;,]+-?\d{1,3}(?:[._]\d{4,})/;
const SPLITS: readonly CorpusSplit[] = ['development', 'validation', 'held_out_test'];
const SCENES: readonly CorpusSceneType[] = [
  'protected_cycleway', 'unprotected_cycleway', 'mixed_traffic', 'intersection',
  'sidewalk', 'transit_corridor', 'shared_space', 'other',
];
const LIGHTING: readonly CorpusLighting[] = ['day', 'backlight', 'dusk_dawn', 'night', 'mixed'];
const VIEW_ANGLES: readonly CorpusViewAngle[] = ['low_oblique', 'medium_oblique', 'high_oblique', 'near_overhead', 'other'];
const RATINGS: readonly CaptureConditionRating[] = ['good', 'mixed', 'poor', 'unknown'];
const ORIENTATIONS: readonly CaptureOrientation[] = ['landscape', 'portrait', 'square', 'unknown'];
const MOUNTS: readonly CaptureMount[] = ['fixed', 'temporary_fixed', 'handheld', 'unknown'];
const POWER: readonly CapturePowerSource[] = ['mains', 'battery', 'unknown'];
const PROFILES: readonly NodePerformanceProfile[] = ['eco', 'balanced', 'performance'];

function assertOpaqueId(value: string, label: string): void {
  if (!OPAQUE_ID.test(value)) throw new Error(`${label} must be an opaque 1-64 character token`);
  if (COORDINATE_PAIR.test(value)) throw new Error(`${label} must not encode precise coordinates`);
}

function assertPositiveFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be finite and greater than zero`);
}

function assertEnum<T extends string>(value: T, allowed: readonly T[], label: string): void {
  if (!allowed.includes(value)) throw new Error(`Unsupported ${label} ${value}`);
}

export function validatePilotCaptureRecord(record: PilotCaptureRecord): void {
  if (record.schemaVersion !== '1') throw new Error('Unsupported pilot capture schemaVersion');
  if (record.recordType !== 'konta2r_pilot_capture') throw new Error('Unsupported pilot capture recordType');
  assertOpaqueId(record.captureId, 'captureId');
  assertOpaqueId(record.siteId, 'siteId');
  assertEnum(record.plannedSplit, SPLITS, 'plannedSplit');
  if (Number.isNaN(Date.parse(record.startedAtIso))) throw new Error('startedAtIso must be a valid ISO date');
  assertPositiveFinite(record.durationSeconds, 'durationSeconds');

  assertEnum(record.scene.sceneType, SCENES, 'sceneType');
  assertEnum(record.scene.lighting, LIGHTING, 'lighting');
  assertEnum(record.scene.viewAngle, VIEW_ANGLES, 'viewAngle');
  assertEnum(record.scene.reflections, RATINGS, 'reflections');
  assertEnum(record.scene.sceneOcclusion, RATINGS, 'sceneOcclusion');
  assertEnum(record.scene.cameraStability, RATINGS, 'cameraStability');

  if (!Number.isInteger(record.camera.width) || record.camera.width <= 0) throw new Error('camera width must be a positive integer');
  if (!Number.isInteger(record.camera.height) || record.camera.height <= 0) throw new Error('camera height must be a positive integer');
  assertPositiveFinite(record.camera.frameRate, 'camera frameRate');
  assertEnum(record.camera.orientation, ORIENTATIONS, 'camera orientation');
  assertEnum(record.camera.mount, MOUNTS, 'camera mount');

  assertEnum(record.device.profile, PROFILES, 'device profile');
  if (!Number.isInteger(record.device.hardwareConcurrency) || record.device.hardwareConcurrency <= 0) {
    throw new Error('hardwareConcurrency must be a positive integer');
  }
  if (record.device.deviceMemoryGiB !== undefined) assertPositiveFinite(record.device.deviceMemoryGiB, 'deviceMemoryGiB');
  assertEnum(record.device.powerSource, POWER, 'powerSource');

  if (record.notes) {
    if (record.notes.length > 20) throw new Error('Pilot capture record supports at most 20 notes');
    for (const note of record.notes) {
      if (note.trim().length === 0) throw new Error('Pilot capture notes cannot be empty');
      if (note.length > 500) throw new Error('Pilot capture notes must be 500 characters or fewer');
    }
  }
}

export function serializePilotCaptureRecord(record: PilotCaptureRecord): string {
  validatePilotCaptureRecord(record);
  return `${JSON.stringify(record, null, 2)}\n`;
}
