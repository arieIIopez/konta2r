import {
  classifyImageScale,
  type AnnotatedBenchmarkSequence,
  type GroundTruthOcclusion,
  type ImageScaleBin,
} from './benchmarkDataset';
import { DETECTOR_GROUND_TRUTH_CLASSES } from './annotationDraft';

export type CorpusCompositionFindingSeverity = 'info' | 'warning';

export interface CorpusCompositionFinding {
  code:
    | 'sampling_plan_incomplete'
    | 'very_few_frames'
    | 'no_negative_frames'
    | 'no_occluded_objects'
    | 'no_tiny_or_small_objects'
    | 'manual_frames_present'
    | 'class_absent';
  severity: CorpusCompositionFindingSeverity;
  message: string;
  className?: string;
}

export interface CorpusCompositionReport {
  schemaVersion: '1';
  datasetId: string;
  sequenceId: string;
  frameCount: number;
  objectCount: number;
  evaluableObjectCount: number;
  ignoredObjectCount: number;
  negativeFrameCount: number;
  classCounts: Record<string, number>;
  occlusionCounts: Record<GroundTruthOcclusion, number>;
  imageScaleCounts: Record<ImageScaleBin, number>;
  selectionCounts: {
    planned: number;
    manual: number;
    unclassified: number;
  };
  samplingCoverage?: {
    plannedCount: number;
    capturedPlannedCount: number;
    ratio: number;
  };
  findings: CorpusCompositionFinding[];
}

function increment(record: Record<string, number>, key: string): void {
  record[key] = (record[key] ?? 0) + 1;
}

/**
 * Describes what is present in an annotated sequence. It intentionally does
 * not return pass/fail or a quality score: corpus adequacy depends on the
 * research question and on the multi-sequence sampling design.
 */
export function summarizeCorpusComposition(
  sequence: AnnotatedBenchmarkSequence,
): CorpusCompositionReport {
  const classCounts: Record<string, number> = {};
  const occlusionCounts: Record<GroundTruthOcclusion, number> = {
    none: 0,
    partial: 0,
    heavy: 0,
  };
  const imageScaleCounts: Record<ImageScaleBin, number> = {
    tiny: 0,
    small: 0,
    medium: 0,
    large: 0,
  };
  const selectionCounts = { planned: 0, manual: 0, unclassified: 0 };
  let objectCount = 0;
  let evaluableObjectCount = 0;
  let ignoredObjectCount = 0;
  let negativeFrameCount = 0;
  const capturedPlanIndices = new Set<number>();

  for (const frame of sequence.frames) {
    if (frame.selection?.source === 'planned') {
      selectionCounts.planned += 1;
      if (frame.selection.planIndex !== undefined) capturedPlanIndices.add(frame.selection.planIndex);
    } else if (frame.selection?.source === 'manual') {
      selectionCounts.manual += 1;
    } else {
      selectionCounts.unclassified += 1;
    }

    const evaluableInFrame = frame.objects.filter((object) => object.ignore !== true).length;
    if (evaluableInFrame === 0) negativeFrameCount += 1;

    for (const object of frame.objects) {
      objectCount += 1;
      increment(classCounts, object.className);
      if (object.ignore === true) {
        ignoredObjectCount += 1;
        continue;
      }
      evaluableObjectCount += 1;
      const occlusion = object.occlusion ?? 'none';
      occlusionCounts[occlusion] += 1;
      imageScaleCounts[classifyImageScale(object.bbox, frame.height)] += 1;
    }
  }

  const findings: CorpusCompositionFinding[] = [];
  if (sequence.frames.length < 2) {
    findings.push({
      code: 'very_few_frames',
      severity: 'warning',
      message: 'La secuencia tiene menos de dos frames; no permite describir variación temporal dentro del video.',
    });
  }

  let samplingCoverage: CorpusCompositionReport['samplingCoverage'];
  if (sequence.samplingPlan) {
    const plannedCount = sequence.samplingPlan.sampleCount;
    const capturedPlannedCount = capturedPlanIndices.size;
    samplingCoverage = {
      plannedCount,
      capturedPlannedCount,
      ratio: plannedCount > 0 ? capturedPlannedCount / plannedCount : 0,
    };
    if (capturedPlannedCount < plannedCount) {
      findings.push({
        code: 'sampling_plan_incomplete',
        severity: 'warning',
        message: `El plan temporal está incompleto: ${capturedPlannedCount}/${plannedCount} muestras planificadas fueron capturadas.`,
      });
    }
  }

  if (selectionCounts.manual > 0) {
    findings.push({
      code: 'manual_frames_present',
      severity: 'info',
      message: `${selectionCounts.manual} frame(s) manual(es) deben analizarse separadamente si el objetivo es estimar desempeño representativo del plan temporal.`,
    });
  }

  if (negativeFrameCount === 0 && sequence.frames.length > 0) {
    findings.push({
      code: 'no_negative_frames',
      severity: 'info',
      message: 'No hay frames sin objetos evaluables; el corpus expone menos situaciones puramente de fondo para observar falsos positivos.',
    });
  }

  if (occlusionCounts.partial + occlusionCounts.heavy === 0 && evaluableObjectCount > 0) {
    findings.push({
      code: 'no_occluded_objects',
      severity: 'info',
      message: 'No hay objetos evaluables con oclusión parcial o fuerte; este corpus no describe desempeño bajo oclusión.',
    });
  }

  if (imageScaleCounts.tiny + imageScaleCounts.small === 0 && evaluableObjectCount > 0) {
    findings.push({
      code: 'no_tiny_or_small_objects',
      severity: 'info',
      message: 'No hay objetos evaluables tiny/small según los umbrales de escala de imagen; el desempeño a larga distancia no queda cubierto.',
    });
  }

  for (const className of DETECTOR_GROUND_TRUTH_CLASSES) {
    if ((classCounts[className] ?? 0) === 0) {
      findings.push({
        code: 'class_absent',
        severity: 'info',
        className,
        message: `La clase ${className} no aparece en esta secuencia; no pueden calcularse métricas de esa clase a partir de este video.`,
      });
    }
  }

  return {
    schemaVersion: '1',
    datasetId: sequence.datasetId,
    sequenceId: sequence.sequenceId,
    frameCount: sequence.frames.length,
    objectCount,
    evaluableObjectCount,
    ignoredObjectCount,
    negativeFrameCount,
    classCounts,
    occlusionCounts,
    imageScaleCounts,
    selectionCounts,
    ...(samplingCoverage === undefined ? {} : { samplingCoverage }),
    findings,
  };
}
