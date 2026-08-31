import {
  validatePilotCaptureRecord,
  type CaptureConditionRating,
  type CaptureMount,
  type CaptureOrientation,
  type CapturePowerSource,
  type PilotCaptureRecord,
} from './pilotCaptureRecord';
import type {
  CorpusLighting,
  CorpusSceneType,
  CorpusSplit,
  CorpusViewAngle,
} from './corpusManifest';
import type { NodePerformanceProfile } from '../node/deviceProfile';

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  return value;
}

function number(value: unknown, label: string): number {
  if (typeof value !== 'number') throw new Error(`${label} must be a number`);
  return value;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean`);
  return value;
}

function optionalString(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : string(value, label);
}

function optionalNumber(value: unknown, label: string): number | undefined {
  return value === undefined ? undefined : number(value, label);
}

function stringArray(value: unknown, label: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((item, index) => string(item, `${label}[${index}]`));
}

export function parsePilotCaptureRecordJson(text: string): PilotCaptureRecord {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('Pilot capture file is not valid JSON');
  }
  const root = object(raw, 'pilot capture');
  const scene = object(root.scene, 'scene');
  const camera = object(root.camera, 'camera');
  const device = object(root.device, 'device');
  const media = root.media === undefined ? undefined : object(root.media, 'media');
  const facingMode = optionalString(camera.facingMode, 'camera.facingMode');
  const deviceMemoryGiB = optionalNumber(device.deviceMemoryGiB, 'device.deviceMemoryGiB');
  const userAgent = optionalString(device.userAgent, 'device.userAgent');
  const notes = stringArray(root.notes, 'notes');

  const record: PilotCaptureRecord = {
    schemaVersion: string(root.schemaVersion, 'schemaVersion') as '1',
    recordType: string(root.recordType, 'recordType') as 'konta2r_pilot_capture',
    captureId: string(root.captureId, 'captureId'),
    siteId: string(root.siteId, 'siteId'),
    plannedSplit: string(root.plannedSplit, 'plannedSplit') as CorpusSplit,
    startedAtIso: string(root.startedAtIso, 'startedAtIso'),
    durationSeconds: number(root.durationSeconds, 'durationSeconds'),
    scene: {
      sceneType: string(scene.sceneType, 'scene.sceneType') as CorpusSceneType,
      lighting: string(scene.lighting, 'scene.lighting') as CorpusLighting,
      viewAngle: string(scene.viewAngle, 'scene.viewAngle') as CorpusViewAngle,
      throughGlass: boolean(scene.throughGlass, 'scene.throughGlass'),
      reflections: string(scene.reflections, 'scene.reflections') as CaptureConditionRating,
      sceneOcclusion: string(scene.sceneOcclusion, 'scene.sceneOcclusion') as CaptureConditionRating,
      cameraStability: string(scene.cameraStability, 'scene.cameraStability') as CaptureConditionRating,
    },
    camera: {
      width: number(camera.width, 'camera.width'),
      height: number(camera.height, 'camera.height'),
      frameRate: number(camera.frameRate, 'camera.frameRate'),
      orientation: string(camera.orientation, 'camera.orientation') as CaptureOrientation,
      mount: string(camera.mount, 'camera.mount') as CaptureMount,
      ...(facingMode === undefined ? {} : { facingMode }),
    },
    device: {
      profile: string(device.profile, 'device.profile') as NodePerformanceProfile,
      hardwareConcurrency: number(device.hardwareConcurrency, 'device.hardwareConcurrency'),
      webgpu: boolean(device.webgpu, 'device.webgpu'),
      powerSource: string(device.powerSource, 'device.powerSource') as CapturePowerSource,
      ...(deviceMemoryGiB === undefined ? {} : { deviceMemoryGiB }),
      ...(userAgent === undefined ? {} : { userAgent }),
    },
    ...(media === undefined ? {} : {
      media: {
        sha256: string(media.sha256, 'media.sha256'),
        sizeBytes: number(media.sizeBytes, 'media.sizeBytes'),
        mimeType: string(media.mimeType, 'media.mimeType'),
      },
    }),
    ...(notes === undefined ? {} : { notes }),
  };

  validatePilotCaptureRecord(record);
  return record;
}
