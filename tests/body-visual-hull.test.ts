import { describe, expect, it } from "vitest";
import { buildBodyCalibration } from "../src/lib/mirro/body-calibration";
import { buildBodyVisualHull } from "../src/lib/mirro/body-visual-hull";
import {
  pointInsideExpandedBody,
  projectParticleOutsideBody,
} from "../src/lib/mirro/body-collision";
import type {
  BodyMeasurements,
  BodySide,
  BodySilhouette,
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
});
