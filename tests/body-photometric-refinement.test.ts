import { describe, expect, it } from "vitest";
import { buildBodyCalibration } from "../src/lib/mirro/body-calibration";
import { refineVisualHullPhotometrically } from "../src/lib/mirro/body-photometric-refinement";
import {
  BODY_VIEW_ANGLE_RAD,
  BODY_VIEW_SEQUENCE,
} from "../src/lib/mirro/body-views";
import type { RgbaImage } from "../src/lib/mirro/body-calibration";
import type {
  BodySilhouette,
  BodyViewId,
  BodyVisualHull,
} from "../src/lib/mirro/types";

const IMAGE_WIDTH = 160;
const IMAGE_HEIGHT = 320;
const BOUNDS_HEIGHT = 280;
const BOUNDS_Y = 20;
const ROW_WIDTH_PX = 72;
const TRUE_DIAMETER_CM = 36;
const TRUE_RADIUS_CM = TRUE_DIAMETER_CM / 2;

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
    foregroundRatio: 0.3,
    backgroundThreshold: 40,
    confidence: 1,
    metricWidthProfileCm: new Array(samples).fill(
      TRUE_DIAMETER_CM,
    ),
    metricBodyHeightCm: 174,
  };
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
  const halfWidth = ROW_WIDTH_PX / 2;
  const angle = BODY_VIEW_ANGLE_RAD[view];

  for (let y = BOUNDS_Y; y < BOUNDS_Y + BOUNDS_HEIGHT; y += 1) {
    for (
      let x = Math.floor(centerX - halfWidth);
      x <= Math.ceil(centerX + halfWidth);
      x += 1
    ) {
      const horizontalCm =
        ((x - centerX) / ROW_WIDTH_PX) *
        TRUE_DIAMETER_CM;
      if (Math.abs(horizontalCm) > TRUE_RADIUS_CM) continue;

      const delta = Math.asin(
        horizontalCm / TRUE_RADIUS_CM,
      );
      const worldPhi = angle + delta;
      const value = Math.round(
        125 +
          70 * Math.sin(worldPhi * 3) +
          25 * Math.cos(worldPhi * 5),
      );
      const pixel = y * IMAGE_WIDTH + x;
      const offset = pixel * 4;
      mask[pixel] = 1;
      image.data[offset] = value;
      image.data[offset + 1] = Math.round(
        110 + 55 * Math.cos(worldPhi * 2),
      );
      image.data[offset + 2] = Math.round(
        120 + 45 * Math.sin(worldPhi * 4),
      );
      image.data[offset + 3] = 255;
    }
  }

  return { image, mask };
}

describe("classical turntable photometric refinement", () => {
  it("moves an oversized torso surface inward toward photometric agreement", () => {
    const silhouettes = Object.fromEntries(
      BODY_VIEW_SEQUENCE.map((view) => [
        view,
        silhouette(),
      ]),
    ) as Record<BodyViewId, BodySilhouette>;
    const generated = Object.fromEntries(
      BODY_VIEW_SEQUENCE.map((view) => [
        view,
        syntheticView(view),
      ]),
    ) as Record<
      BodyViewId,
      ReturnType<typeof syntheticView>
    >;

    const base = buildBodyCalibration(
      {
        front: silhouettes.front,
        right: silhouettes.right,
        back: silhouettes.back,
        left: silhouettes.left,
      },
      {
        heightCm: 174,
        chestCm: 113,
        waistCm: 102,
        hipsCm: 113,
      },
    );

    const phi = Math.PI / 8;
    const oversizedRadius = 19.2;
    const hull: BodyVisualHull = {
      version: 2,
      method: "eight-view-turntable-marching-tetrahedra-v2",
      captureMode: "fixed-camera-person-turntable",
      resolution: { x: 3, y: 3, z: 3 },
      boundsCm: {
        width: 42,
        height: 178,
        depth: 42,
      },
      originCm: [-21, -89, -21],
      gridStepCm: [21, 89, 21],
      voxelSizeCm: 1,
      viewCount: 8,
      viewAnglesDeg: [0, 45, 90, 135, 180, 225, 270, 315],
      occupiedVoxelCount: 1,
      occupancyRle: { start: 0, runs: [13, 1, 13] },
      vertices: [
        oversizedRadius * Math.sin(phi),
        0,
        oversizedRadius * Math.cos(phi),
      ],
      normals: [Math.sin(phi), 0, Math.cos(phi)],
      indices: [],
    };

    const refined = refineVisualHullPhotometrically({
      hull,
      baseMesh: base.mesh,
      images: Object.fromEntries(
        BODY_VIEW_SEQUENCE.map((view) => [
          view,
          generated[view].image,
        ]),
      ),
      masks: Object.fromEntries(
        BODY_VIEW_SEQUENCE.map((view) => [
          view,
          generated[view].mask,
        ]),
      ),
      silhouettes,
      bodyHeightCm: 174,
    });

    const surface =
      refined.photometricRefinement?.surfaceVertices;
    expect(surface).toBeDefined();
    const radius = Math.hypot(
      surface?.[0] ?? 0,
      surface?.[2] ?? 0,
    );

    expect(
      refined.photometricRefinement?.refinedVertexCount,
    ).toBe(1);
    expect(radius).toBeLessThan(oversizedRadius - 0.2);
    expect(radius).toBeGreaterThan(TRUE_RADIUS_CM - 0.8);
    expect(
      refined.photometricRefinement?.meanRelativeImprovement ??
        0,
    ).toBeGreaterThan(0.085);

    expect(Math.hypot(hull.vertices[0], hull.vertices[2])).toBeCloseTo(
      oversizedRadius,
      6,
    );
  });
});
