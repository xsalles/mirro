import { describe, expect, it } from "vitest";
import { buildBodyCalibration } from "../src/lib/mirro/body-calibration";
import { buildBodyVisualHull } from "../src/lib/mirro/body-visual-hull";
import {
  pointInsideExpandedBody,
  projectParticleOutsideBody,
} from "../src/lib/mirro/body-collision";
import {
  buildSignedDistanceField,
  sampleSignedDistance,
  sampleSignedDistanceGradient,
} from "../src/lib/mirro/signed-distance-field";
import type {
  BodyMeasurements,
  BodySide,
  BodySilhouette,
  BodyViewId,
} from "../src/lib/mirro/types";

function silhouette(
  widthProfile: number[],
  metricWidthCm: number,
  boundsWidth: number,
): BodySilhouette {
  return {
    sourceWidth: 160,
    sourceHeight: 320,
    bounds: {
      x: (160 - boundsWidth) / 2,
      y: 20,
      width: boundsWidth,
      height: 280,
    },
    widthProfile,
    centerProfile: new Array(widthProfile.length).fill(0),
    foregroundRatio: 0.3,
    backgroundThreshold: 40,
    confidence: 0.96,
    metricWidthProfileCm: new Array(
      widthProfile.length,
    ).fill(metricWidthCm),
    metricBodyHeightCm: 174,
  };
}

function rectangularMask(
  boundsWidth: number,
) {
  const width = 160;
  const height = 320;
  const mask = new Uint8Array(width * height);
  const minX = Math.round((width - boundsWidth) / 2);
  const maxX = Math.round((width + boundsWidth) / 2);

  for (let y = 20; y < 300; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      mask[y * width + x] = 1;
    }
  }

  return { mask, width, height };
}

describe("dense body visual hull", () => {
  it("carves a persistent surface and uses its occupancy for collision", () => {
    const samples = 48;
    const frontProfile = new Array(samples).fill(0.25);
    const sideProfile = new Array(samples).fill(0.15);
    const silhouettes: Record<BodySide, BodySilhouette> = {
      front: silhouette(frontProfile, 44, 72),
      back: silhouette(frontProfile, 44, 72),
      right: silhouette(sideProfile, 27, 44),
      left: silhouette(sideProfile, 27, 44),
    };
    const measurements: BodyMeasurements = {
      heightCm: 174,
      chestCm: 96,
      waistCm: 82,
      hipsCm: 98,
    };
    const base = buildBodyCalibration(
      silhouettes,
      measurements,
    );
    const hull = buildBodyVisualHull({
      views: {
        front: rectangularMask(72),
        back: rectangularMask(72),
        right: rectangularMask(44),
        left: rectangularMask(44),
      },
      silhouettes,
      baseMesh: base.mesh,
      bodyHeightCm: measurements.heightCm,
    });

    expect(hull.occupiedVoxelCount).toBeGreaterThan(100);
    expect(hull.vertices.length / 3).toBeGreaterThan(100);
    expect(hull.indices.length / 3).toBeGreaterThan(100);
    expect(hull.occupancyRle.runs.length).toBeGreaterThan(1);

    const mesh = {
      ...base.mesh,
      visualHull: hull,
    };
    expect(
      pointInsideExpandedBody(mesh, 0, 0, 0),
    ).toBe(true);
    expect(
      pointInsideExpandedBody(
        mesh,
        hull.boundsCm.width,
        0,
        0,
      ),
    ).toBe(false);

    const particle = [0, 0, 0];
    expect(
      projectParticleOutsideBody(
        mesh,
        particle,
        0,
        0.2,
      ),
    ).toBe(true);
    expect(
      pointInsideExpandedBody(
        mesh,
        particle[0],
        particle[1],
        particle[2],
      ),
    ).toBe(false);
  });

  it("uses 45-degree silhouettes to tighten the hull and persists an SDF", () => {
    const samples = 48;
    const profile = new Array(samples).fill(40 / 174);
    const allSilhouettes = Object.fromEntries(
      (
        [
          "front",
          "frontRight",
          "right",
          "backRight",
          "back",
          "backLeft",
          "left",
          "frontLeft",
        ] as BodyViewId[]
      ).map((view) => [
        view,
        silhouette(profile, 40, 64),
      ]),
    ) as Record<BodyViewId, BodySilhouette>;

    const measurements: BodyMeasurements = {
      heightCm: 174,
      chestCm: 126,
      waistCm: 112,
      hipsCm: 126,
    };
    const base = buildBodyCalibration(
      {
        front: allSilhouettes.front,
        right: allSilhouettes.right,
        back: allSilhouettes.back,
        left: allSilhouettes.left,
      },
      measurements,
    );

    const four = buildBodyVisualHull({
      views: {
        front: rectangularMask(64),
        right: rectangularMask(64),
        back: rectangularMask(64),
        left: rectangularMask(64),
      },
      silhouettes: {
        front: allSilhouettes.front,
        right: allSilhouettes.right,
        back: allSilhouettes.back,
        left: allSilhouettes.left,
      },
      baseMesh: base.mesh,
      bodyHeightCm: measurements.heightCm,
    });

    const eightViews = Object.fromEntries(
      (
        [
          "front",
          "frontRight",
          "right",
          "backRight",
          "back",
          "backLeft",
          "left",
          "frontLeft",
        ] as BodyViewId[]
      ).map((view) => [view, rectangularMask(64)]),
    ) as Record<BodyViewId, ReturnType<typeof rectangularMask>>;

    const eight = buildBodyVisualHull({
      views: eightViews,
      silhouettes: allSilhouettes,
      baseMesh: base.mesh,
      bodyHeightCm: measurements.heightCm,
    });

    expect(four.viewCount).toBe(4);
    expect(eight.viewCount).toBe(8);
    expect(eight.version).toBe(2);
    expect(eight.method).toBe(
      "eight-view-turntable-marching-tetrahedra-v2",
    );
    expect(eight.occupiedVoxelCount).toBeLessThan(
      four.occupiedVoxelCount * 0.96,
    );
    expect(eight.signedDistanceField).toBeDefined();
    expect(eight.signedDistanceField?.values).toBeInstanceOf(
      Int16Array,
    );
  });

  it("builds a smooth signed distance gradient for non-axis collision", () => {
    const size = 25;
    const occupancy = new Uint8Array(size * size * size);
    const center = (size - 1) / 2;
    const indexOf = (x: number, y: number, z: number) =>
      (y * size + z) * size + x;

    for (let y = 0; y < size; y += 1) {
      for (let z = 0; z < size; z += 1) {
        for (let x = 0; x < size; x += 1) {
          const dx = x - center;
          const dy = y - center;
          const dz = z - center;
          if (Math.hypot(dx, dy, dz) <= 7) {
            occupancy[indexOf(x, y, z)] = 1;
          }
        }
      }
    }

    const sdf = buildSignedDistanceField({
      occupancy,
      resolution: { x: size, y: size, z: size },
      originCm: [-12, -12, -12],
      stepCm: [1, 1, 1],
      quantizationCm: 0.02,
    });

    expect(sampleSignedDistance(sdf, 0, 0, 0)).toBeLessThan(0);
    expect(sampleSignedDistance(sdf, 10, 0, 0)).toBeGreaterThan(0);

    const point: [number, number, number] = [4, 0, 3];
    const gradient = sampleSignedDistanceGradient(
      sdf,
      point[0],
      point[1],
      point[2],
    );
    const radialLength = Math.hypot(point[0], point[2]);
    const radialX = point[0] / radialLength;
    const radialZ = point[2] / radialLength;
    const alignment =
      gradient[0] * radialX + gradient[2] * radialZ;

    expect(Math.abs(gradient[0])).toBeGreaterThan(0.25);
    expect(Math.abs(gradient[2])).toBeGreaterThan(0.2);
    expect(alignment).toBeGreaterThan(0.75);
  });

});
