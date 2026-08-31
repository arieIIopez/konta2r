export type DetectorCandidateStatus = 'probe_pending' | 'probe_verified' | 'benchmarking' | 'rejected';
export type DetectorCandidateRole = 'legacy_baseline' | 'eco_candidate' | 'balanced_candidate' | 'performance_candidate';

export interface ExternalModelArtifact {
  url: string;
  sha256: string;
  declaredLicense: string;
  redistributionVerified: boolean;
  approximateSizeMb?: number;
}

export interface DetectorCandidateRecord {
  id: string;
  displayName: string;
  architecture: string;
  role: DetectorCandidateRole;
  status: DetectorCandidateStatus;
  dataset: string;
  inputHint?: {
    width: number;
    height: number;
    layout: 'NHWC' | 'NCHW' | 'unknown';
    evidence: string;
  };
  artifact: ExternalModelArtifact;
  sourceRepository: string;
  notes: string[];
  evidenceUrls: string[];
}

/**
 * First real artifact to probe, not a production selection. Hugging Face
 * publishes the file SHA-256 and declares Apache-2.0 for the repository. The
 * redistribution flag remains false until Konta2r records a completed license
 * review for the weights themselves.
 */
export const KALRAY_SSD_MOBILENET_V2_COCO: DetectorCandidateRecord = {
  id: 'kalray-ssd-mobilenet-v2-coco',
  displayName: 'SSD MobileNet V2 COCO — Kalray',
  architecture: 'SSD MobileNet V2',
  role: 'legacy_baseline',
  status: 'probe_pending',
  dataset: 'COCO',
  inputHint: {
    width: 300,
    height: 300,
    layout: 'NHWC',
    evidence: 'TensorFlow SSD MobileNet V2 COCO source configuration uses fixed_shape_resizer 300x300.',
  },
  artifact: {
    url: 'https://huggingface.co/Kalray/ssd-mobilenet-v2/resolve/main/ssd-mobilenet-v2.onnx',
    sha256: 'f0d9458cd8ae5c0cde8eadf22b75c6451059f4d9dd46df266e996dcbec417a8f',
    declaredLicense: 'Apache-2.0',
    redistributionVerified: false,
    approximateSizeMb: 67.4,
  },
  sourceRepository: 'https://huggingface.co/Kalray/ssd-mobilenet-v2',
  notes: [
    'Use only as an experimental low-cost baseline until its observed ONNX IO contract is recorded.',
    'Do not bundle or redistribute from Konta2r while redistributionVerified=false.',
    'Historical TensorFlow SSD MobileNet V2 COCO accuracy is modest; this candidate is not presumed to be the final detector.',
  ],
  evidenceUrls: [
    'https://huggingface.co/Kalray/ssd-mobilenet-v2',
    'https://huggingface.co/Kalray/ssd-mobilenet-v2/blob/main/ssd-mobilenet-v2.onnx',
    'https://github.com/tensorflow/models/blob/master/research/object_detection/samples/configs/ssd_mobilenet_v2_coco.config',
  ],
};

export const DETECTOR_CANDIDATES: readonly DetectorCandidateRecord[] = [
  KALRAY_SSD_MOBILENET_V2_COCO,
];
