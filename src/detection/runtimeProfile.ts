import type { DetectorBackend } from './types';
import type { DetectorLatencySummary } from './benchmark';

export type EdgeInferenceProfileName = 'eco' | 'balanced' | 'performance';

export interface EdgeInferenceProfile {
  name: EdgeInferenceProfileName;
  targetInferenceHz: number;
  minInferenceIntervalMs: number;
  preferredInputLongSide: number;
  maxDetections: number;
  notes: string[];
}

export interface RuntimeCapabilitySnapshot {
  webGpuAvailable: boolean;
  hardwareConcurrency?: number;
  deviceMemoryGb?: number;
}

export interface RuntimeRecommendation {
  executionProviders: DetectorBackend[];
  profile: EdgeInferenceProfile;
  reasons: string[];
}

export const EDGE_PROFILES: Record<EdgeInferenceProfileName, EdgeInferenceProfile> = {
  eco: {
    name: 'eco',
    targetInferenceHz: 2.5,
    minInferenceIntervalMs: 400,
    preferredInputLongSide: 416,
    maxDetections: 60,
    notes: ['Prioriza continuidad térmica y compatibilidad con teléfonos antiguos.'],
  },
  balanced: {
    name: 'balanced',
    targetInferenceHz: 5,
    minInferenceIntervalMs: 200,
    preferredInputLongSide: 512,
    maxDetections: 90,
    notes: ['Equilibra resolución temporal, consumo y densidad de escena.'],
  },
  performance: {
    name: 'performance',
    targetInferenceHz: 10,
    minInferenceIntervalMs: 100,
    preferredInputLongSide: 640,
    maxDetections: 120,
    notes: ['Usar solo cuando el benchmark sostenido mantenga latencia y estabilidad.'],
  },
};

/** Runtime feature detection without requiring experimental DOM typings. */
export function snapshotRuntimeCapabilities(navigatorLike: Navigator = navigator): RuntimeCapabilitySnapshot {
  const extended = navigatorLike as Navigator & {
    gpu?: unknown;
    deviceMemory?: number;
  };
  return {
    webGpuAvailable: extended.gpu !== undefined,
    ...(navigatorLike.hardwareConcurrency === undefined
      ? {}
      : { hardwareConcurrency: navigatorLike.hardwareConcurrency }),
    ...(extended.deviceMemory === undefined ? {} : { deviceMemoryGb: extended.deviceMemory }),
  };
}

export function recommendProfileFromLatency(
  latency: DetectorLatencySummary,
): EdgeInferenceProfileName {
  // Use p95, not average, because tracking is harmed by sporadic long stalls.
  if (latency.totalMsP95 <= 85 && latency.latencyDriftRatio <= 0.2) return 'performance';
  if (latency.totalMsP95 <= 190 && latency.latencyDriftRatio <= 0.35) return 'balanced';
  return 'eco';
}

export function recommendRuntime(
  capabilities: RuntimeCapabilitySnapshot,
  sustainedLatency?: DetectorLatencySummary,
): RuntimeRecommendation {
  const reasons: string[] = [];
  const executionProviders: DetectorBackend[] = capabilities.webGpuAvailable
    ? ['webgpu', 'wasm']
    : ['wasm'];

  if (capabilities.webGpuAvailable) {
    reasons.push('WebGPU disponible; se prioriza GPU con WASM como fallback.');
  } else {
    reasons.push('WebGPU no disponible; se utiliza WASM para máxima compatibilidad.');
  }

  let profileName: EdgeInferenceProfileName;
  if (sustainedLatency) {
    profileName = recommendProfileFromLatency(sustainedLatency);
    reasons.push(`Perfil elegido desde benchmark sostenido p95=${sustainedLatency.totalMsP95.toFixed(0)} ms.`);
    if (sustainedLatency.latencyDriftRatio > 0.25) {
      reasons.push('Se observó deriva de latencia; se evita un perfil más agresivo por posible throttling.');
    }
  } else {
    const cores = capabilities.hardwareConcurrency ?? 2;
    const memory = capabilities.deviceMemoryGb ?? 2;
    if (capabilities.webGpuAvailable && cores >= 8 && memory >= 6) {
      profileName = 'performance';
    } else if (cores >= 4 && memory >= 3) {
      profileName = 'balanced';
    } else {
      profileName = 'eco';
    }
    reasons.push('Selección inicial heurística; debe reemplazarse por benchmark del dispositivo al instalar el nodo.');
  }

  return {
    executionProviders,
    profile: EDGE_PROFILES[profileName],
    reasons,
  };
}
