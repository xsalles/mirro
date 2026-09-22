import { describe, expect, it } from "vitest";
import type { RgbaImage } from "../src/lib/mirro/body-calibration";
import { buildClassicalMultiViewStereo } from "../src/lib/mirro/body-mvs";
import {
  BODY_VIEW_ANGLE_RAD,
  BODY_VIEW_SEQUENCE,
} from "../src/lib/mirro/body-views";
import { buildSignedDistanceField } from "../src/lib/mirro/signed-distance-field";
import type {
  BodySilhouette,
  BodyViewId,
  BodyVisualHull,
  OpticalCalibrationProfile,
} from "../src/lib/mirro/types";

const IMAGE_WIDTH = 160;
const IMAGE_HEIGHT = 160;
const BODY_HEIGHT_CM = 60;
const TRUE_RADIUS_CM = 18;
const HULL_RADIUS_CM = 20;
const CAMERA_DISTANCE_CM = 170;
const FX = 300;
const FY = 300;
const CX = 80;
const CY = 80;
const BOUNDS = {
  x: 48,
  y: 20,
  width: 64,
  height: 120,
};

function silhouette(): BodySilhouette {
  const samples = 48;
  return {
    sourceWidth: IMAGE_WIDTH,
    sourceHeight: IMAGE_HEIGHT,
    bounds: BOUNDS,
    widthProfile: new Array(samples).fill(
      BOUNDS.width / BOUNDS.height,
    ),
    centerProfile: new Array(samples).fill(0),
    foregroundRatio: 0.34,
    backgroundThreshold: 40,
    confidence: 1,
    metricWidthProfileCm: new Array(samples).fill(
      TRUE_RADIUS_CM * 2,
    ),
    metricBodyHeightCm: BODY_HEIGHT_CM,
  };
}

function worldFromView(
  view: BodyViewId,
  horizontalCm: number,
  y: number,
  depthCm: number,
) {
  const angle = BODY_VIEW_ANGLE_RAD[view];
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [
    horizontalCm * cos + depthCm * sin,
    y,
    -horizontalCm * sin + depthCm * cos,
  ] as const;
}

function syntheticPerspectiveView(view: BodyViewId) {
  const image: RgbaImage = {
    width: IMAGE_WIDTH,
    height: IMAGE_HEIGHT,
    data: new Uint8ClampedArray(
      IMAGE_WIDTH * IMAGE_HEIGHT * 4,
    ),
  };
  const mask = new Uint8Array(
    IMAGE_WIDTH * IMAGE_HEIGHT,
  );

  for (let py = BOUNDS.y; py < BOUNDS.y + BOUNDS.height; py += 1) {
    for (let px = BOUNDS.x; px < BOUNDS.x + BOUNDS.width; px += 1) {
      const rayX = (px - CX) / FX;
      const rayY = -(py - CY) / FY;
      const a = 1 + rayX * rayX;
      const b = -2 * CAMERA_DISTANCE_CM;
      const cc =
        CAMERA_DISTANCE_CM * CAMERA_DISTANCE_CM -
        TRUE_RADIUS_CM * TRUE_RADIUS_CM;
      const discriminant = b * b - 4 * a * cc;
      if (discriminant <= 0) continue;

      const cameraDepth =
        (-b - Math.sqrt(discriminant)) / (2 * a);
      if (cameraDepth <= 0) continue;

      const horizontalCm = rayX * cameraDepth;
      const worldY = rayY * cameraDepth;
      const depthCm =
        CAMERA_DISTANCE_CM - cameraDepth;

      if (
        worldY < -BODY_HEIGHT_CM / 2 ||
        worldY > BODY_HEIGHT_CM / 2
      ) {
        continue;
      }

      const world = worldFromView(
        view,
        horizontalCm,
        worldY,
        depthCm,
      );
      const phi = Math.atan2(world[0], world[2]);
      const texture =
        124 +
        54 * Math.sin(phi * 3.2 + worldY * 0.13) +
        28 * Math.cos(phi * 5.5 - worldY * 0.09) +
        17 * Math.sin(phi * 7.7 + worldY * 0.17);

      const pixel = py * IMAGE_WIDTH + px;
      const offset = pixel * 4;
      mask[pixel] = 1;
      image.data[offset] = Math.max(
        0,
        Math.min(255, Math.round(texture)),
      );
      image.data[offset + 1] = Math.max(
        0,
        Math.min(
          255,
          Math.round(
            119 +
              43 * Math.cos(phi * 2.6 + worldY * 0.1),
          ),
        ),
      );
      image.data[offset + 2] = Math.max(
        0,
        Math.min(
          255,
          Math.round(
            127 +
              39 * Math.sin(phi * 4.4 - worldY * 0.14),
          ),
        ),
      );
      image.data[offset + 3] = 255;
    }
  }

  return { image, mask };
}

function hull(): BodyVisualHull {
  const resolution = { x: 45, y: 65, z: 45 };
  const origin: [number, number, number] = [
    -22,
    -32,
    -22,
  ];
  const step: [number, number, number] = [1, 1, 1];
  const occupancy = new Uint8Array(
    resolution.x * resolution.y * resolution.z,
  );
  let occupied = 0;

  for (let y = 0; y < resolution.y; y += 1) {
    const worldY = origin[1] + y;
    if (
      worldY < -BODY_HEIGHT_CM / 2 ||
      worldY > BODY_HEIGHT_CM / 2
    ) {
      continue;
    }

    for (let z = 0; z < resolution.z; z += 1) {
      const worldZ = origin[2] + z;
      for (let x = 0; x < resolution.x; x += 1) {
        const worldX = origin[0] + x;
        if (
          Math.hypot(worldX, worldZ) <=
          HULL_RADIUS_CM
        ) {
          occupancy[
            (y * resolution.z + z) *
              resolution.x +
              x
          ] = 1;
          occupied += 1;
        }
      }
    }
  }

  const vertices: number[] = [];
  const normals: number[] = [];
  for (let index = 0; index < 32; index += 1) {
    const angle = (index / 32) * Math.PI * 2;
    vertices.push(
      Math.sin(angle) * HULL_RADIUS_CM,
      0,
      Math.cos(angle) * HULL_RADIUS_CM,
    );
    normals.push(
      Math.sin(angle),
      0,
      Math.cos(angle),
    );
  }

  return {
    version: 2,
    method: "eight-view-turntable-marching-tetrahedra-v2",
    captureMode: "fixed-camera-person-turntable",
    resolution,
    boundsCm: {
      width: 44,
      height: 64,
      depth: 44,
    },
    originCm: origin,
    gridStepCm: step,
    voxelSizeCm: 1,
    viewCount: 8,
    viewAnglesDeg: [
      0, 45, 90, 135, 180, 225, 270, 315,
    ],
    occupiedVoxelCount: occupied,
    occupancyRle: {
      start: 0,
      runs: [occupancy.length],
    },
    vertices,
    normals,
    indices: [],
    signedDistanceField: buildSignedDistanceField({
      occupancy,
      resolution,
      originCm: origin,
      stepCm: step,
      quantizationCm: 0.03,
      maxDistanceCm: 30,
    }),
  };
}

function optics(): OpticalCalibrationProfile {
  return {
    version: 1,
    method: "multi-frame-brown-conrady-v1",
    intrinsics: {
      fx: FX,
      fy: FY,
      cx: CX,
      cy: CY,
      skew: 0,
    },
    distortion: {
      k1: 0,
      k2: 0,
      k3: 0,
      p1: 0,
      p2: 0,
    },
    frameCount: 8,
    imageWidth: IMAGE_WIDTH,
    imageHeight: IMAGE_HEIGHT,
    rmsReprojectionErrorPx: 0.1,
    conditionScore: 1,
    iterations: 1,
    frames: [],
    warnings: [],
    createdAt: new Date(0).toISOString(),
  };
}

describe("calibrated perspective turntable MVS", () => {
  it("recovers perspective depth using saved optical intrinsics", () => {
    const silhouettes = Object.fromEntries(
      BODY_VIEW_SEQUENCE.map((view) => [
        view,
        silhouette(),
      ]),
    ) as Record<BodyViewId, BodySilhouette>;
    const generated = Object.fromEntries(
      BODY_VIEW_SEQUENCE.map((view) => [
        view,
        syntheticPerspectiveView(view),
      ]),
    ) as Record<
      BodyViewId,
      ReturnType<typeof syntheticPerspectiveView>
    >;

    const mvs = buildClassicalMultiViewStereo({
      hull: hull(),
      images: Object.fromEntries(
        BODY_VIEW_SEQUENCE.map((view) => [
          view,
          generated[view].image,
        ]),
      ) as Record<BodyViewId, RgbaImage>,
      masks: Object.fromEntries(
        BODY_VIEW_SEQUENCE.map((view) => [
          view,
          generated[view].mask,
        ]),
      ) as Record<BodyViewId, Uint8Array>,
      silhouettes,
      bodyHeightCm: BODY_HEIGHT_CM,
      optics: optics(),
    });

    expect(mvs).not.toBeNull();
    if (!mvs) return;

    expect(mvs.projectionModel).toBe(
      "calibrated-turntable-perspective",
    );
    expect(mvs.meanCameraDistanceCm).toBeGreaterThan(166);
    expect(mvs.meanCameraDistanceCm).toBeLessThan(174);
    expect(mvs.validDepthCount).toBeGreaterThan(350);
    expect(mvs.crossViewConsistency).toBeGreaterThan(0.16);

    const front = mvs.depthMaps.front;
    const centerX = Math.floor(front.width / 2);
    const centerY = Math.floor(front.height / 2);
    let central:
      | { depth: number; confidence: number; radius: number }
      | null = null;

    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        const x = centerX + dx;
        const y = centerY + dy;
        const index = y * front.width + x;
        const confidence = front.confidence[index];
        if (!confidence) continue;
        const depth =
          front.depthValues[index] *
          front.depthQuantizationCm;
        const radius = Math.hypot(dx, dy);

        if (
          !central ||
          radius < central.radius ||
          (radius === central.radius &&
            confidence > central.confidence)
        ) {
          central = { depth, confidence, radius };
        }
      }
    }

    expect(central).not.toBeNull();
    expect(central?.radius ?? Infinity).toBeLessThanOrEqual(2.25);
    expect(central?.confidence ?? 0).toBeGreaterThan(0);
    expect(central?.depth ?? 0).toBeGreaterThan(16.5);
    expect(central?.depth ?? Infinity).toBeLessThan(19.4);
  });
});
