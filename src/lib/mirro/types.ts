export type BodySide = "front" | "right" | "back" | "left";

export type MediaRef = {
  key: string;
  name: string;
  type: string;
  size: number;
};

export type BodyProfile = {
  heightCm: number;
  chestCm: number;
  waistCm: number;
  hipsCm: number;
  photos: Partial<Record<BodySide, MediaRef>>;
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
