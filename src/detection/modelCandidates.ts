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
 * Independent 2026 ONNX conversion of the same TensorFlow frozen graph. Konta2r
 * has now verified the exact checkpoint hash and executed its uint8/NHWC SSD
 * contract with ONNX Runtime Web/WASM. This is technical probe verification,
 * not detector selection, benchmark validation or redistribution approval.
 */
export const OPENCV_SSD_MOBILENET_V2_COCO_2026JUL: DetectorCandidateRecord = {
  id: 'opencv-ssd-mobilenet-v2-coco-2026jul',
  displayName: 'SSD MobileNet V2 COCO — OpenCV contribution 2026-07',
  architecture: 'SSD MobileNet V2',
  role: 'legacy_baseline',
  status: 'probe_verified',
  dataset: 'COCO',
  codecId: 'ssd_tf_object_detection',
  inputHint: {
    width: 300,
    height: 300,
    layout: 'NHWC',
    evidence: 'Source documentation plus Konta2r runtime smoke confirm raw RGB uint8 image_tensor:0 [1,300,300,3].',
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
    'Technical probe verified on 2026-08-31: exact SHA-256 matched and ONNX Runtime Web/WASM executed uint8 [1,300,300,3].',
    'Runtime smoke produced boxes [1,100,4], scores [1,100], classes [1,100] and num_detections [1].',
    'Primary graph metadata remains symbolic; runtime smoke evidence is stored separately under docs/benchmarks/evidence.',
    'Probe verification does not imply accuracy acceptance, production selection or permission to redistribute weights.',
    'Do not bundle from Konta2r while redistributionVerified=false.',
  ],
  evidenceUrls: [
    'https://huggingface.co/opencv/opencv_contribution/tree/main/ssd_mobilenet_v2_coco_2018_03_29',
    'https://huggingface.co/opencv/opencv_contribution/blob/main/ssd_mobilenet_v2_coco_2018_03_29/README.md',
    'https://huggingface.co/opencv/opencv_contribution/blob/main/ssd_mobilenet_v2_coco_2018_03_29/convert_to_onnx.py',
    'https://huggingface.co/opencv/opencv_contribution/blob/main/ssd_mobilenet_v2_coco_2018_03_29/ssd_mobilenet_v2_coco_2018_03_29_2026jul.onnx',
    'https://github.com/arieIIopez/konta2r/blob/develop/docs/benchmarks/evidence/opencv-ssd-mobilenet-v2-coco-2026jul-probe.json',
  ],
};

/**
 * Lightweight OpenCV Zoo NanoDet-m-plus-1.5x candidate. The Git LFS pointer in
 * the official model directory publishes the exact checkpoint SHA-256 and byte
 * size. The directory states Apache-2.0 for all files, but Konta2r keeps
 * redistributionVerified=false until its own weight-license review is closed.
 *
 * No codecId is declared yet: source code documents preprocessing/postprocess,
 * but Konta2r must first observe the actual ONNX IO contract before encoding it.
 */
export const OPENCV_NANODET_M_PLUS_1_5X_416: DetectorCandidateRecord = {
  id: 'opencv-nanodet-m-plus-1.5x-416-2022nov',
  displayName: 'NanoDet-m-plus-1.5x 416 — OpenCV Zoo',
  architecture: 'NanoDet-Plus / GFL anchor-free detector',
  role: 'eco_candidate',
  status: 'probe_pending',
  dataset: 'COCO 2017',
  inputHint: {
    width: 416,
    height: 416,
    layout: 'NCHW',
    evidence: 'OpenCV Zoo nanodet.py uses image_shape=(416,416) and cv2.dnn.blobFromImage after float32 mean/std normalization.',
  },
  artifact: {
    url: 'https://github.com/opencv/opencv_zoo/raw/main/models/object_detection_nanodet/object_detection_nanodet_2022nov.onnx',
    sha256: '4b82da9944b88577175ee23a459dce2e26e6e4be573def65b1055dc2d9720186',
    declaredLicense: 'Apache-2.0',
    redistributionVerified: false,
    approximateSizeMb: 3.8,
  },
  sourceRepository: 'https://github.com/opencv/opencv_zoo/tree/main/models/object_detection_nanodet',
  notes: [
    'Official OpenCV Zoo model: Nanodet-m-plus-1.5x_416.',
    'OpenCV Zoo reports COCO AP 0.304 and publishes class-level AP for mobility-relevant classes.',
    'The official Git LFS pointer reports 3,800,954 bytes and SHA-256 4b82da9944b88577175ee23a459dce2e26e6e4be573def65b1055dc2d9720186.',
    'No Konta2r codec is assigned until a real ONNX probe records input/output names, types and shapes.',
    'Do not bundle from Konta2r while redistributionVerified=false.',
  ],
  evidenceUrls: [
    'https://github.com/opencv/opencv_zoo/tree/main/models/object_detection_nanodet',
    'https://github.com/opencv/opencv_zoo/blob/main/models/object_detection_nanodet/README.md',
    'https://github.com/opencv/opencv_zoo/blob/main/models/object_detection_nanodet/nanodet.py',
    'https://github.com/opencv/opencv_zoo/blob/main/models/object_detection_nanodet/LICENSE',
    'https://github.com/opencv/opencv_zoo/blob/main/models/object_detection_nanodet/object_detection_nanodet_2022nov.onnx',
  ],
};

export const DETECTOR_CANDIDATES: readonly DetectorCandidateRecord[] = [
  KALRAY_SSD_MOBILENET_V2_COCO,
  OPENCV_SSD_MOBILENET_V2_COCO_2026JUL,
  OPENCV_NANODET_M_PLUS_1_5X_416,
];
