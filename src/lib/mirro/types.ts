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
    };

export type BodyMesh = {
  version: 1 | 2;
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
  radiusXProfile?: number[];
  radiusZProfile?: number[];
  torsoTopRing?: number;
  torsoBottomRing?: number;
  parts?: BodyPartMesh[];
  collisionPrimitives?: BodyCollisionPrimitive[];
};

export type BodyCalibration = {
  version: 1 | 2;
  method:
    | "weak-perspective-elliptical-hull-v1"
    | "weak-perspective-anatomical-primitives-v2";
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
};
