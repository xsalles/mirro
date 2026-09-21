import type {
  BodyMesh,
  ClothMaterial,
  GarmentMesh,
} from "./types";

export type ClothWorkerStartMessage = {
  type: "start";
  mesh: GarmentMesh;
  bodyMesh: BodyMesh;
  material: ClothMaterial;
  steps: number;
  dt: number;
  iterations: number;
  snapshotEvery: number;
};

export type ClothWorkerProgressMessage = {
  type: "progress";
  step: number;
  totalSteps: number;
  positions: number[];
  collisions: number;
  selfCollisions: number;
};

export type ClothWorkerDoneMessage = {
  type: "done";
  mesh: GarmentMesh;
  collisions: number;
  selfCollisions: number;
  maxDisplacementCm: number;
};

export type ClothWorkerErrorMessage = {
  type: "error";
  message: string;
};

export type ClothWorkerResponse =
  | ClothWorkerProgressMessage
  | ClothWorkerDoneMessage
  | ClothWorkerErrorMessage;
