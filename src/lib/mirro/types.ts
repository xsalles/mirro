export type BodySide = "front" | "right" | "back" | "left";

export type BodyViewId =
  | "front"
  | "frontRight"
  | "right"
  | "backRight"
  | "back"
  | "backLeft"
  | "left"
  | "frontLeft";

export type MediaRef = {
  key: string;
  name: string;
  type: string;
  size: number;
};

export type BodyMeasurements = {
  heightCm: number;
  chestCm: number;
  waistCm: number;
  hipsCm: number;
  shoulderWidthCm?: number;
  armLengthCm?: number;
  upperArmCm?: number;
  thighCm?: number;
  inseamCm?: number;
};

export type CameraIntrinsics = {
  fx: number;
  fy: number;
  cx: number;
  cy: number;
  skew: number;
};

export type LensDistortion = {
  k1: number;
  k2: number;
  k3: number;
  p1: number;
  p2: number;
};

export type CameraExtrinsics = {
  rotation: [
    number, number, number,
    number, number, number,
    number, number, number
  ];
  translation: [number, number, number];
};

export type BodyViewCalibration = {
  method: "mirro-a4-color-target-v1" | "mirro-a4-pinhole-v2";
  pixelsPerCm: number;
  rollRadians: number;
  perspectiveSkew: number;
  score: number;
  imageWidth?: number;
  imageHeight?: number;
  homography?: [
    number, number, number,
    number, number, number,
    number, number, number
  ];
  extrinsics?: CameraExtrinsics;
  reprojectionErrorPx?: number;
  targetBounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  markerCenters: {
    magenta: [number, number];
    cyan: [number, number];
    yellow: [number, number];
    blue: [number, number];
  };
};

export type BodyCameraRig = {
  version: 1 | 2;
  method:
    | "shared-pinhole-bundle-v1"
    | "brown-conrady-bundle-v2";
  intrinsics: CameraIntrinsics;
  distortion?: LensDistortion;
  views: Record<BodySide, CameraExtrinsics & {
    reprojectionErrorPx: number;
    homography: [
      number, number, number,
      number, number, number,
      number, number, number
    ];
  }>;
  rmsReprojectionErrorPx: number;
  iterations: number;
  conditionScore: number;
  warnings: string[];
  distortionRmsImprovementPx?: number;
};

export type BodyTextureCalibration = {
  version: 1 | 2;
  method:
    | "log-luminance-rgb-gain-v1"
    | "local-grid-rgb-transfer-v2";
  gains: Record<BodySide, [number, number, number]>;
  meanLuminance: Record<BodySide, number>;
  grid?: {
    columns: number;
    rows: number;
    gains: Record<BodySide, Array<[number, number, number]>>;
  };
  score: number;
};

export type BodySilhouette = {
  sourceWidth: number;
  sourceHeight: number;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  widthProfile: number[];
  centerProfile?: number[];
  foregroundRatio: number;
  backgroundThreshold: number;
  confidence: number;
  metricWidthProfileCm?: number[];
  metricBodyHeightCm?: number;
  viewCalibration?: BodyViewCalibration;
};

export type OpticalCalibrationFrame = {
  id: string;
  calibration: BodyViewCalibration;
  extrinsics: CameraExtrinsics;
  reprojectionErrorPx: number;
};

export type OpticalCalibrationProfile = {
  version: 1;
  method: "multi-frame-brown-conrady-v1";
  intrinsics: CameraIntrinsics;
  distortion: LensDistortion;
  frameCount: number;
  imageWidth: number;
  imageHeight: number;
  rmsReprojectionErrorPx: number;
  conditionScore: number;
  iterations: number;
  frames: OpticalCalibrationFrame[];
  warnings: string[];
  createdAt: string;
};

export type BodySignedDistanceField = {
  version: 1;
  method: "exact-edt-sdf-v1";
  resolution: {
    x: number;
    y: number;
    z: number;
  };
  originCm: [number, number, number];
  stepCm: [number, number, number];
  quantizationCm: number;
  maxDistanceCm: number;
  values: Int16Array;
};

export type BodyDepthMap = {
  version: 1 | 2;
  method:
    | "turntable-zncc-plane-sweep-v1"
    | "turntable-robust-coarse-to-fine-v2";
  view: BodyViewId;
  width: number;
  height: number;
  depthQuantizationCm: number;
  depthValues: Int16Array;
  confidence: Uint8Array;
  validCount: number;
  meanConfidence: number;
  subpixelRefinedCount?: number;
  meanSubpixelOffsetCm?: number;
};

export type BodyTsdfVolume = {
  version: 1;
  method: "multi-depth-tsdf-fusion-v1";
  resolution: {
    x: number;
    y: number;
    z: number;
  };
  originCm: [number, number, number];
  stepCm: [number, number, number];
  truncationCm: number;
  quantizationCm: number;
  values: Int16Array;
  weights: Uint8Array;
};

export type BodyMultiViewStereo = {
  version: 1 | 2;
  method:
    | "turntable-zncc-tsdf-v1"
    | "turntable-robust-subpixel-tsdf-v2";
  projectionModel:
    | "metric-orthographic"
    | "calibrated-turntable-perspective";
  meanCameraDistanceCm?: number;
  matchingModel?:
    | "zncc"
    | "zncc-census-gradient";
  depthRefinement?:
    | "discrete"
    | "coarse-to-fine-parabolic";
  matchingKernel?:
    | "js-popcnt"
    | "wasm-popcnt32-v1";
  executionBackend?:
    | "main-js"
    | "main-wasm"
    | "worker-js"
    | "worker-wasm";
  subpixelRefinedCount?: number;
  turntableRig?: {
    version: 1;
    method: "shared-axis-center-least-squares-v1";
    optimized: boolean;
    axisCenterCm: [number, number, number];
    sharedCameraDistanceCm?: number;
    verticalOpticalOffsetCm?: number;
    centerResidualCm: number;
  };
  depthMaps: Record<BodyViewId, BodyDepthMap>;
  tsdf: BodyTsdfVolume;
  surfaceVertices: number[];
  surfaceNormals: number[];
  surfaceIndices: number[];
  validDepthCount: number;
  meanConfidence: number;
  crossViewConsistency: number;
  fusedVoxelCount: number;
};

export type BodyVisualHull = {
  version: 1 | 2;
  method:
    | "four-view-turntable-marching-tetrahedra-v1"
    | "eight-view-turntable-marching-tetrahedra-v2";
  captureMode: "fixed-camera-person-turntable";
  resolution: {
    x: number;
    y: number;
    z: number;
  };
  boundsCm: {
    width: number;
    height: number;
    depth: number;
  };
  originCm: [number, number, number];
  gridStepCm?: [number, number, number];
  voxelSizeCm: number;
  viewCount?: 4 | 8;
  viewAnglesDeg?: number[];
  occupiedVoxelCount: number;
  occupancyRle: {
    start: 0 | 1;
    runs: number[];
  };
  vertices: number[];
  normals: number[];
  indices: number[];
  signedDistanceField?: BodySignedDistanceField;
  photometricRefinement?: {
    version: 1;
    method: "turntable-plane-sweep-photoconsistency-v1";
    refinedVertexCount: number;
    meanInwardOffsetCm: number;
    maxInwardOffsetCm: number;
    meanRelativeImprovement: number;
    surfaceVertices?: number[];
    surfaceNormals?: number[];
  };
  multiViewStereo?: BodyMultiViewStereo;
};

export type BodyPartKind =
  | "head"
  | "torso"
  | "left-arm"
  | "right-arm"
  | "left-leg"
  | "right-leg";

export type BodyPartMesh = {
  kind: BodyPartKind;
  vertexStart: number;
  vertexCount: number;
  indexStart: number;
  indexCount: number;
  centerCm: [number, number, number];
  boundsCm: {
    width: number;
    height: number;
    depth: number;
  };
};

export type BodyCollisionPrimitive =
  | {
      type: "ellipsoid";
      part: "head";
      center: [number, number, number];
      radii: [number, number, number];
    }
  | {
      type: "tapered-capsule";
      part: "left-arm" | "right-arm" | "left-leg" | "right-leg";
      start: [number, number, number];
      end: [number, number, number];
      startRadius: number;
      endRadius: number;
    }
  | {
      type: "elliptical-hull";
      part: "torso";
      topY: number;
      bottomY: number;
      radiusX: number[];
      radiusZ: number[];
      centerZ?: number[];
    };

export type BodyMesh = {
  version: 1 | 2 | 3 | 4;
  coordinateSystem: "x-right-y-up-z-front-centimeters";
  ringCount: number;
  segmentsPerRing: number;
  vertices: number[];
  normals: number[];
  indices: number[];
  landmarks: {
    chestRing: number;
    waistRing: number;
    hipsRing: number;
    shoulderRing?: number;
    crotchRing?: number;
  };
  boundsCm: {
    width: number;
    height: number;
    depth: number;
  };
  radiusXProfile?: number[];
  radiusZProfile?: number[];
  centerZProfile?: number[];
  torsoTopRing?: number;
  torsoBottomRing?: number;
  parts?: BodyPartMesh[];
  collisionPrimitives?: BodyCollisionPrimitive[];
  visualHull?: BodyVisualHull;
};

export type BodyCalibration = {
  version: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  method:
    | "weak-perspective-elliptical-hull-v1"
    | "weak-perspective-anatomical-primitives-v2"
    | "metric-target-anatomical-v3"
    | "pinhole-bundle-anatomical-v4"
    | "lens-undistorted-local-color-surface-v5"
    | "visual-hull-multiband-v6"
    | "eight-view-sdf-gradient-seams-v7"
    | "turntable-zncc-tsdf-mvs-v8"
    | "robust-subpixel-worker-mvs-v9";
  sampleCount: number;
  silhouettes: Record<BodySide, BodySilhouette>;
  denseSilhouettes?: Partial<Record<BodyViewId, BodySilhouette>>;
  mesh: BodyMesh;
  viewCalibration?: Partial<Record<BodySide, BodyViewCalibration>>;
  cameraRig?: BodyCameraRig;
  textureCalibration?: BodyTextureCalibration;
  quality: {
    score: number;
    frontBackDifference: number;
    sideDifference: number;
    warnings: string[];
  };
  createdAt: string;
};

export type BodyProfile = BodyMeasurements & {
  photos: Partial<Record<BodyViewId, MediaRef>>;
  calibration?: BodyCalibration;
  updatedAt: string;
};

export type GarmentCategory = "top" | "shirt" | "hoodie" | "pants" | "shorts";
export type FabricWeight = "light" | "medium" | "heavy";
export type StretchLevel = "none" | "low" | "medium" | "high";

export type FabricPhysicalProfile = {
  densityGsm: number;
  thicknessMm: number;
  stretchWarpPct: number;
  stretchWeftPct: number;
  bendStiffness: number;
  friction: number;
};

export type GarmentRowInterval = [number, number];

export type GarmentSilhouette = {
  sourceWidth: number;
  sourceHeight: number;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  widthProfile: number[];
  centerProfile: number[];
  occupancyRatio: number;
  intervalProfile?: GarmentRowInterval[][];
};

export type GarmentCalibration = {
  version: 1;
  method: "alpha-profile-v1";
  sampleCount: number;
  front: GarmentSilhouette;
  back: GarmentSilhouette;
  quality: {
    score: number;
    frontBackDifference: number;
    warnings: string[];
  };
  createdAt: string;
};

export type FabricLibraryEntry = {
  id: string;
  name: string;
  family: string;
  composition: string;
  source: "engineering-preset";
  profile: FabricPhysicalProfile;
  notes: string;
};

export type Garment = {
  id: string;
  name: string;
  category: GarmentCategory;
  size: string;
  fabricWeight: FabricWeight;
  stretch: StretchLevel;
  images: {
    front: MediaRef;
    back: MediaRef;
  };
  calibration?: GarmentCalibration;
  physicalProfile?: FabricPhysicalProfile;
  fabricLibraryId?: string;
  createdAt: string;
};

export type ClothConstraintKind = "structural" | "shear" | "bend" | "seam";

export type ClothConstraintAxis = "warp" | "weft" | "bias" | "none";

export type ClothConstraint = {
  kind: ClothConstraintKind;
  axis?: ClothConstraintAxis;
  a: number;
  b: number;
  restLength: number;
  lambda: number;
};

export type ClothMaterial = {
  stretchCompliance: number;
  stretchWarpCompliance?: number;
  stretchWeftCompliance?: number;
  shearCompliance: number;
  bendCompliance: number;
  densityGsm?: number;
  particleInverseMass?: number;
  seamCompliance: number;
  damping: number;
  gravityCmPerSec2: number;
  thicknessCm: number;
  friction: number;
};

export type GarmentRegionKind =
  | "torso-front"
  | "torso-back"
  | "left-sleeve-front"
  | "left-sleeve-back"
  | "right-sleeve-front"
  | "right-sleeve-back"
  | "waist-front"
  | "waist-back"
  | "left-leg-front"
  | "left-leg-back"
  | "right-leg-front"
  | "right-leg-back";

export type GarmentMeshRegion = {
  id: number;
  kind: GarmentRegionKind;
  vertexStart: number;
  vertexCount: number;
  indexStart: number;
  indexCount: number;
};

export type GarmentMesh = {
  version: 1 | 2;
  coordinateSystem: "x-right-y-up-z-front-centimeters";
  category: GarmentCategory;
  rows: number;
  cols: number;
  panelVertexCount: number;
  positions: number[];
  previousPositions: number[];
  inverseMass: number[];
  uv: number[];
  indices: number[];
  constraints: ClothConstraint[];
  boundsCm: {
    width: number;
    height: number;
    depth: number;
  };
  textureSide?: number[];
  regionIds?: number[];
  regions?: GarmentMeshRegion[];
};

export type ClothSimulationStats = {
  steps: number;
  collisions: number;
  selfCollisions: number;
  maxDisplacementCm: number;
};

export type MirroState = {
  profile: BodyProfile | null;
  garments: Garment[];
  optics?: OpticalCalibrationProfile | null;
};
