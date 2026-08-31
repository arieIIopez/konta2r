export type DetectorCandidateStatus = 'probe_pending' | 'probe_verified' | 'benchmarking' | 'rejected';
export type DetectorCandidateRole = 'legacy_baseline' | 'eco_candidate' | 'balanced_candidate' | 'performance_candidate';
export type DetectorCandidateCodecId = 'ssd_tf_object_detection';

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
  codecId?: DetectorCandidateCodecId;
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
  codecId: 'ssd_tf_object_detection',
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

/**
 * Independent 2026 ONNX conversion of the same TensorFlow frozen graph. Unlike
 * the Kalray artifact, this source documents exact tensor names, uint8/NHWC
 * preprocessing, a runnable ONNX Runtime demo and the ONNX file SHA-256. It is
 * still probe_pending until Konta2r observes the artifact with its own runtime.
 */
export const OPENCV_SSD_MOBILENET_V2_COCO_2026JUL: DetectorCandidateRecord = {
  id: 'opencv-ssd-mobilenet-v2-coco-2026jul',
  displayName: 'SSD MobileNet V2 COCO — OpenCV contribution 2026-07',
  architecture: 'SSD MobileNet V2',
  role: 'legacy_baseline',
  status: 'probe_pending',
  dataset: 'COCO',
  codecId: 'ssd_tf_object_detection',
  inputHint: {
    width: 300,
    height: 300,
    layout: 'NHWC',
    evidence: 'Source README and conversion script document raw RGB uint8 image_tensor:0 [1,300,300,3].',
  },
  artifact: {
    url: 'https://huggingface.co/opencv/opencv_contribution/resolve/main/ssd_mobilenet_v2_coco_2018_03_29/ssd_mobilenet_v2_coco_2018_03_29_2026jul.onnx',
    sha256: '7ba2fdaa87b8cbbb52c16b5c6e31a7452c00e8ad68aec580bfb7b07f5b212619',
    declaredLicense: 'Apache-2.0',
    redistributionVerified: false,
    approximateSizeMb: 69.6,
  },
  sourceRepository: 'https://huggingface.co/opencv/opencv_contribution/tree/main/ssd_mobilenet_v2_coco_2018_03_29',
  notes: [
    'The source documents image_tensor:0 and the four TensorFlow Object Detection API outputs explicitly.',
    'The repository includes an ONNX Runtime demo and records the original TensorFlow weights source.',
    'Treat as an independent candidate; do not infer binary equivalence with the Kalray conversion.',
    'Do not bundle from Konta2r while redistributionVerified=false.',
  ],
  evidenceUrls: [
    'https://huggingface.co/opencv/opencv_contribution/tree/main/ssd_mobilenet_v2_coco_2018_03_29',
    'https://huggingface.co/opencv/opencv_contribution/blob/main/ssd_mobilenet_v2_coco_2018_03_29/README.md',
    'https://huggingface.co/opencv/opencv_contribution/blob/main/ssd_mobilenet_v2_coco_2018_03_29/convert_to_onnx.py',
    'https://huggingface.co/opencv/opencv_contribution/blob/main/ssd_mobilenet_v2_coco_2018_03_29/ssd_mobilenet_v2_coco_2018_03_29_2026jul.onnx',
  ],
};

export const DETECTOR_CANDIDATES: readonly DetectorCandidateRecord[] = [
  KALRAY_SSD_MOBILENET_V2_COCO,
  OPENCV_SSD_MOBILENET_V2_COCO_2026JUL,
];
