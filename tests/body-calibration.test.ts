import { describe, expect, it } from "vitest";
import {
  buildBodyCalibration,
  segmentBodySilhouette,
  type RgbaImage,
} from "../src/lib/mirro/body-calibration";
import type { BodyMeasurements, BodySilhouette } from "../src/lib/mirro/types";

function syntheticPerson(width = 160, height = 280): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 242;
    data[i + 1] = 244;
    data[i + 2] = 246;
    data[i + 3] = 255;
  }

  const top = 18;
  const bottom = height - 17;
  const centerX = width / 2;

  for (let y = top; y <= bottom; y += 1) {
    const t = (y - top) / (bottom - top);
    let halfWidth = 14;
    if (t < 0.12) halfWidth = 13 - Math.abs(t - 0.06) * 30;
    else if (t < 0.34) halfWidth = 30;
    else if (t < 0.5) halfWidth = 24;
    else if (t < 0.62) halfWidth = 29;
    else if (t < 0.78) halfWidth = 23;
    else halfWidth = 17;

    const minX = Math.round(centerX - halfWidth);
    const maxX = Math.round(centerX + halfWidth);
    for (let x = minX; x <= maxX; x += 1) {
      const offset = (y * width + x) * 4;
      data[offset] = 38;
      data[offset + 1] = 42;
      data[offset + 2] = 48;
      data[offset + 3] = 255;
    }
  }

  return { width, height, data };
}

function fakeSilhouette(
  profile: number[],
  confidence = 0.92,
): BodySilhouette {
  return {
    sourceWidth: 400,
    sourceHeight: 800,
    bounds: { x: 100, y: 40, width: 200, height: 720 },
    widthProfile: profile,
    foregroundRatio: 0.28,
    backgroundThreshold: 40,
    confidence,
  };
}

function shapedProfile(samples: number, side = false) {
  return Array.from({ length: samples }, (_, index) => {
    const t = index / (samples - 1);
    if (t < 0.16) return side ? 0.115 : 0.105;
    if (t < 0.36) return side ? 0.145 : 0.245;
    if (t < 0.49) return side ? 0.13 : 0.19;
    if (t < 0.61) return side ? 0.16 : 0.235;
    if (t < 0.76) return side ? 0.13 : 0.19;
    return side ? 0.105 : 0.145;
  });
}

function ellipseCircumference(a: number, b: number) {
  const h = ((a - b) ** 2) / ((a + b) ** 2);
  return Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
}

describe("segmentBodySilhouette", () => {
  it("separates a high-contrast person from a connected flat background", () => {
    const result = segmentBodySilhouette(syntheticPerson());

    expect(result.silhouette.bounds.height).toBeGreaterThan(220);
    expect(result.silhouette.widthProfile).toHaveLength(64);
    expect(result.silhouette.confidence).toBeGreaterThan(0.65);
    expect(result.silhouette.widthProfile[20]).toBeGreaterThan(result.silhouette.widthProfile[2]);
    expect(result.mask.some((value) => value === 1)).toBe(true);
  });
});

describe("buildBodyCalibration", () => {
  const samples = 64;
  const front = shapedProfile(samples, false);
  const side = shapedProfile(samples, true);
  const measurements: BodyMeasurements = {
    heightCm: 178,
    chestCm: 98,
    waistCm: 82,
    hipsCm: 99,
  };

  const calibration = buildBodyCalibration(
    {
      front: fakeSilhouette(front, 0.94),
      back: fakeSilhouette(front.map((value) => value * 0.985), 0.9),
      left: fakeSilhouette(side, 0.91),
      right: fakeSilhouette(side.map((value) => value * 1.015), 0.93),
    },
    measurements,
  );

  it("creates a centimeter-based indexed mesh with normals", () => {
    const mesh = calibration.mesh;
    expect(mesh.ringCount).toBe(samples);
    expect(mesh.segmentsPerRing).toBe(32);
    expect(mesh.vertices.length / 3).toBe(samples * 32 + 2);
    expect(mesh.normals).toHaveLength(mesh.vertices.length);
    expect(mesh.indices.length % 3).toBe(0);
    expect(mesh.boundsCm.height).toBe(measurements.heightCm);
    expect(mesh.boundsCm.width).toBeGreaterThan(mesh.boundsCm.depth);
    expect(mesh.vertices.every(Number.isFinite)).toBe(true);
  });

  it("uses real torso measurements to calibrate cross sections", () => {
    const { mesh } = calibration;
    const checks = [
      [mesh.landmarks.chestRing, measurements.chestCm],
      [mesh.landmarks.waistRing, measurements.waistCm],
      [mesh.landmarks.hipsRing, measurements.hipsCm],
    ] as const;

    for (const [ring, target] of checks) {
      const base = ring * mesh.segmentsPerRing * 3;
      const quarter = (ring * mesh.segmentsPerRing + mesh.segmentsPerRing / 4) * 3;
      const radiusX = Math.abs(mesh.vertices[base]);
      const radiusZ = Math.abs(mesh.vertices[quarter + 2]);
      expect(ellipseCircumference(radiusX, radiusZ)).toBeCloseTo(target, 0);
    }
  });

  it("reports coherent multi-view quality for similar opposite views", () => {
    expect(calibration.quality.score).toBeGreaterThan(0.75);
    expect(calibration.quality.frontBackDifference).toBeLessThan(0.01);
    expect(calibration.quality.sideDifference).toBeLessThan(0.01);
  });
});
