import { NODE_PROFILE_SETTINGS } from '../node/deviceProfile';
import { validatePilotCaptureRecord, type PilotCaptureRecord } from './pilotCaptureRecord';

export type PilotCaptureFindingSeverity = 'info' | 'warning';
export type PilotCaptureFindingCode =
  | 'short_capture'
  | 'low_resolution'
  | 'low_frame_rate'
  | 'profile_capture_below_target'
  | 'handheld_capture'
  | 'poor_camera_stability'
  | 'strong_reflections'
  | 'high_scene_occlusion'
  | 'through_glass'
  | 'battery_powered';

export interface PilotCaptureFinding {
  severity: PilotCaptureFindingSeverity;
  code: PilotCaptureFindingCode;
  message: string;
}

export interface PilotCaptureReview {
  schemaVersion: '1';
  captureId: string;
  plannedSplit: PilotCaptureRecord['plannedSplit'];
  findings: PilotCaptureFinding[];
}

/**
 * Descriptive preflight for field captures. It deliberately does not emit a
 * score or scientific valid/invalid verdict; suitability depends on the pilot
 * question and the role assigned to the sequence in the frozen corpus.
 */
export function reviewPilotCaptureRecord(record: PilotCaptureRecord): PilotCaptureReview {
  validatePilotCaptureRecord(record);
  const findings: PilotCaptureFinding[] = [];
  const target = NODE_PROFILE_SETTINGS[record.device.profile];

  if (record.durationSeconds < 300) {
    findings.push({
      severity: 'warning',
      code: 'short_capture',
      message: 'La captura dura menos de 5 minutos; puede ser insuficiente para observar variación temporal dentro de la secuencia.',
    });
  }
  if (record.camera.width < 640 || record.camera.height < 360) {
    findings.push({
      severity: 'warning',
      code: 'low_resolution',
      message: 'La resolución observada es inferior a 640×360; objetos pequeños pueden quedar subrepresentados.',
    });
  }
  if (record.camera.frameRate < 12) {
    findings.push({
      severity: 'warning',
      code: 'low_frame_rate',
      message: 'El video fue capturado por debajo de 12 FPS; esto puede limitar evaluación temporal y tracking posterior.',
    });
  }
  if (
    record.camera.width < target.captureWidth * 0.8
    || record.camera.height < target.captureHeight * 0.8
    || record.camera.frameRate < target.captureFps * 0.75
  ) {
    findings.push({
      severity: 'info',
      code: 'profile_capture_below_target',
      message: `La captura efectiva quedó por debajo del objetivo del perfil ${record.device.profile}; conservar esta diferencia como evidencia del dispositivo real.`,
    });
  }
  if (record.camera.mount === 'handheld') {
    findings.push({
      severity: 'warning',
      code: 'handheld_capture',
      message: 'La cámara fue usada a mano; el movimiento de fondo puede sesgar detección, tracking y calibración espacial.',
    });
  }
  if (record.scene.cameraStability === 'poor') {
    findings.push({
      severity: 'warning',
      code: 'poor_camera_stability',
      message: 'La estabilidad de cámara fue marcada como pobre; revisar antes de incorporar la secuencia a validation o held_out_test.',
    });
  }
  if (record.scene.reflections === 'poor') {
    findings.push({
      severity: 'warning',
      code: 'strong_reflections',
      message: 'Se registraron reflejos fuertes; anotar esta condición porque puede degradar especialmente objetos pequeños y contrastes bajos.',
    });
  }
  if (record.scene.sceneOcclusion === 'poor') {
    findings.push({
      severity: 'warning',
      code: 'high_scene_occlusion',
      message: 'La escena presenta oclusión alta; puede ser valiosa como condición difícil, pero debe quedar representada explícitamente en el diseño del corpus.',
    });
  }
  if (record.scene.throughGlass) {
    findings.push({
      severity: 'info',
      code: 'through_glass',
      message: 'La captura se realizó a través de vidrio; mantener esta condición separada al comparar desempeño entre sitios.',
    });
  }
  if (record.device.powerSource === 'battery') {
    findings.push({
      severity: 'info',
      code: 'battery_powered',
      message: 'El dispositivo operó con batería; para ensayos prolongados conviene registrar autonomía y eventuales cambios de rendimiento por ahorro energético.',
    });
  }

  return {
    schemaVersion: '1',
    captureId: record.captureId,
    plannedSplit: record.plannedSplit,
    findings,
  };
}
