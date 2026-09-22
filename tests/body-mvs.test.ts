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
} from "../src/lib/mirro/types";

const IMAGE_WIDTH = 160;
const IMAGE_HEIGHT = 160;
const BOUNDS_Y = 20;
const BOUNDS_HEIGHT = 120;
const ROW_WIDTH_PX = 72;
const BODY_HEIGHT_CM = 60;
const TRUE_RADIUS_CM = 18;
const HULL_RADIUS_CM = 20;

function silhouette(): BodySilhouette {
  const samples = 48;
  return {
    sourceWidth: IMAGE_WIDTH,
    sourceHeight: IMAGE_HEIGHT,
    bounds: {
      x: (IMAGE_WIDTH - ROW_WIDTH_PX) / 2,
      y: BOUNDS_Y,
      width: ROW_WIDTH_PX,
      height: BOUNDS_HEIGHT,
    },
    widthProfile: new Array(samples).fill(
      ROW_WIDTH_PX / BOUNDS_HEIGHT,
    ),
    centerProfile: new Array(samples).fill(0),
    foregroundRatio: 0.36,
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

function syntheticView(view: BodyViewId) {
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
  const centerX = IMAGE_WIDTH / 2;

  for (
    let y = BOUNDS_Y;
    y < BOUNDS_Y + BOUNDS_HEIGHT;
    y += 1
  ) {
    const vertical =
      (y - BOUNDS_Y) / Math.max(1, BOUNDS_HEIGHT - 1);
    const worldY =
      BODY_HEIGHT_CM / 2 -
      vertical * BODY_HEIGHT_CM;

    for (
      let x = Math.floor(centerX - ROW_WIDTH_PX / 2);
      x <= Math.ceil(centerX + ROW_WIDTH_PX / 2);
      x += 1
    ) {
      const horizontalCm =
        ((x - centerX) / ROW_WIDTH_PX) *
        (TRUE_RADIUS_CM * 2);
      if (Math.abs(horizontalCm) >= TRUE_RADIUS_CM) {
        continue;
      }

      const depthCm = Math.sqrt(
        TRUE_RADIUS_CM * TRUE_RADIUS_CM -
          horizontalCm * horizontalCm,
      );
      const world = worldFromView(
        view,
        horizontalCm,
        worldY,
        depthCm,
      );
      const phi = Math.atan2(world[0], world[2]);
      const texture =
        126 +
        52 * Math.sin(phi * 3.1 + worldY * 0.11) +
        31 * Math.cos(phi * 5.3 - worldY * 0.07) +
        14 * Math.sin(phi * 8.1 + worldY * 0.19);

      const pixel = y * IMAGE_WIDTH + x;
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
            116 +
              46 * Math.cos(phi * 2.4 + worldY * 0.09),
          ),
        ),
      );
      image.data[offset + 2] = Math.max(
        0,
        Math.min(
          255,
          Math.round(
            122 +
              41 * Math.sin(phi * 4.7 - worldY * 0.12),
          ),
        ),
      );
      image.data[offset + 3] = 255;
    }
  }

  return { image, mask };
}

function syntheticHull(): BodyVisualHull {
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

  const sdf = buildSignedDistanceField({
    occupancy,
    resolution,
    originCm: origin,
    stepCm: step,
    quantizationCm: 0.03,
    maxDistanceCm: 30,
  });

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
    vertices: [],
    normals: [],
    indices: [],
    signedDistanceField: sdf,
  };
}

describe("classical multi-view stereo + TSDF", () => {
  it("recovers a textured cylinder inside a deliberately oversized visual hull", () => {
    const silhouettes = Object.fromEntries(
      BODY_VIEW_SEQUENCE.map((view) => [
        view,
        silhouette(),
      ]),
    ) as Record<BodyViewId, BodySilhouette>;
    const views = Object.fromEntries(
      BODY_VIEW_SEQUENCE.map((view) => [
        view,
        syntheticView(view),
      ]),
    ) as Record<
      BodyViewId,
      ReturnType<typeof syntheticView>
    >;

    const hull = syntheticHull();
    const mvs = buildClassicalMultiViewStereo({
      hull,
      images: Object.fromEntries(
        BODY_VIEW_SEQUENCE.map((view) => [
          view,
          views[view].image,
        ]),
      ) as Record<BodyViewId, RgbaImage>,
      masks: Object.fromEntries(
        BODY_VIEW_SEQUENCE.map((view) => [
          view,
          views[view].mask,
        ]),
      ) as Record<BodyViewId, Uint8Array>,
      silhouettes,
      bodyHeightCm: BODY_HEIGHT_CM,
    });

    expect(mvs).not.toBeNull();
    if (!mvs) return;

    expect(mvs.projectionModel).toBe("metric-orthographic");
    expect(mvs.validDepthCount).toBeGreaterThan(500);
    expect(mvs.meanConfidence).toBeGreaterThan(0.18);
    expect(mvs.crossViewConsistency).toBeGreaterThan(0.2);
    expect(mvs.surfaceIndices.length / 3).toBeGreaterThan(300);

    const front = mvs.depthMaps.front;
    const centerIndex =
      Math.floor(front.height / 2) * front.width +
      Math.floor(front.width / 2);
    const centerDepth =
      front.depthValues[centerIndex] *
      front.depthQuantizationCm;

    expect(front.confidence[centerIndex]).toBeGreaterThan(0);
    expect(centerDepth).toBeGreaterThan(16.5);
    expect(centerDepth).toBeLessThan(19.4);

    const radial: number[] = [];
    for (
      let offset = 0;
      offset < mvs.surfaceVertices.length;
      offset += 3
    ) {
      const x = mvs.surfaceVertices[offset];
      const y = mvs.surfaceVertices[offset + 1];
      const z = mvs.surfaceVertices[offset + 2];
      if (Math.abs(y) > 5) continue;
      radial.push(Math.hypot(x, z));
    }
    radial.sort((a, b) => a - b);
    const median =
      radial[Math.floor(radial.length / 2)] ?? 0;

    expect(radial.length).toBeGreaterThan(50);
    expect(median).toBeGreaterThan(16.5);
    expect(median).toBeLessThan(HULL_RADIUS_CM);

    expect(
      mvs.tsdf.weights.some((weight) => weight > 0),
    ).toBe(true);
    expect(hull.multiViewStereo).toBeUndefined();
  });
});
