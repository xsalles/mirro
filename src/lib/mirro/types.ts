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
  method: "weak-perspective-visual-hull-v1";
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
  createdAt: string;
};

export type MirroState = {
  profile: BodyProfile | null;
  garments: Garment[];
};
