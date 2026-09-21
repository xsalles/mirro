export type BodySide = "front" | "right" | "back" | "left";

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
  foregroundRatio: number;
  backgroundThreshold: number;
  confidence: number;
};

export type BodyMesh = {
  version: 1;
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
  };
  boundsCm: {
    width: number;
    height: number;
    depth: number;
  };
};

export type BodyCalibration = {
  version: 1;
  method: "weak-perspective-elliptical-hull-v1";
  sampleCount: number;
  silhouettes: Record<BodySide, BodySilhouette>;
  mesh: BodyMesh;
  quality: {
    score: number;
    frontBackDifference: number;
    sideDifference: number;
    warnings: string[];
  };
  createdAt: string;
};

export type BodyProfile = BodyMeasurements & {
  photos: Partial<Record<BodySide, MediaRef>>;
  calibration?: BodyCalibration;
  updatedAt: string;
};

export type GarmentCategory = "top" | "shirt" | "hoodie" | "pants" | "shorts";
export type FabricWeight = "light" | "medium" | "heavy";
export type StretchLevel = "none" | "low" | "medium" | "high";

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
  createdAt: string;
};

export type ClothConstraintKind = "structural" | "shear" | "bend" | "seam";

export type ClothConstraint = {
  kind: ClothConstraintKind;
  a: number;
  b: number;
  restLength: number;
  lambda: number;
};

export type ClothMaterial = {
  stretchCompliance: number;
  shearCompliance: number;
  bendCompliance: number;
  seamCompliance: number;
  damping: number;
  gravityCmPerSec2: number;
  thicknessCm: number;
  friction: number;
};

export type GarmentMesh = {
  version: 1;
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
};

export type ClothSimulationStats = {
  steps: number;
  collisions: number;
  maxDisplacementCm: number;
};

export type MirroState = {
  profile: BodyProfile | null;
  garments: Garment[];
};
