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

function metricSilhouette(
  profile: number[],
  confidence = 0.94,
): BodySilhouette {
  const base = fakeSilhouette(profile, confidence);
  return {
    ...base,
    metricWidthProfileCm: profile.map((value) => value * 178),
    metricBodyHeightCm: 178,
    viewCalibration: {
      method: "mirro-a4-color-target-v1",
      pixelsPerCm: 4,
      rollRadians: 0,
      perspectiveSkew: 0.02,
      score: 0.96,
      targetBounds: { x: 10, y: 10, width: 80, height: 120 },
      markerCenters: {
        magenta: [10, 10],
        cyan: [74, 10],
        yellow: [10, 108],
        blue: [74, 108],
      },
    },
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
    expect(result.silhouette.widthProfile).toHaveLength(96);
    expect(result.silhouette.centerProfile).toHaveLength(96);
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

  it("creates an anatomical centimeter-based mesh with separate body parts", () => {
    const mesh = calibration.mesh;
    expect(mesh.version).toBe(2);
    expect(mesh.ringCount).toBe(samples);
    expect(mesh.segmentsPerRing).toBe(48);
    expect(mesh.vertices.length / 3).toBeGreaterThan(900);
    expect(mesh.normals).toHaveLength(mesh.vertices.length);
    expect(mesh.indices.length % 3).toBe(0);
    expect(mesh.boundsCm.height).toBe(measurements.heightCm);
    expect(mesh.vertices.every(Number.isFinite)).toBe(true);

    expect(mesh.parts?.map((part) => part.kind).sort()).toEqual([
      "head",
      "left-arm",
      "left-leg",
      "right-arm",
      "right-leg",
      "torso",
    ]);
    expect(mesh.collisionPrimitives).toHaveLength(6);
  });

  it("uses real torso measurements to calibrate anatomical torso profiles", () => {
    const { mesh } = calibration;
    expect(mesh.radiusXProfile).toBeDefined();
    expect(mesh.radiusZProfile).toBeDefined();

    const checks = [
      [mesh.landmarks.chestRing, measurements.chestCm],
      [mesh.landmarks.waistRing, measurements.waistCm],
      [mesh.landmarks.hipsRing, measurements.hipsCm],
    ] as const;

    for (const [ring, target] of checks) {
      const radiusX = mesh.radiusXProfile?.[ring] ?? 0;
      const radiusZ = mesh.radiusZProfile?.[ring] ?? 0;
      expect(ellipseCircumference(radiusX, radiusZ)).toBeCloseTo(target, 0);
    }
  });

  it("stores shoulder and crotch landmarks for semantic garments", () => {
    expect(calibration.mesh.landmarks.shoulderRing).toBeTypeOf("number");
    expect(calibration.mesh.landmarks.crotchRing).toBeTypeOf("number");
    expect(calibration.mesh.landmarks.shoulderRing).toBeLessThan(
      calibration.mesh.landmarks.chestRing,
    );
    expect(calibration.mesh.landmarks.crotchRing).toBeGreaterThan(
      calibration.mesh.landmarks.hipsRing,
    );
  });

  it("reports coherent multi-view quality for similar opposite views", () => {
    expect(calibration.quality.score).toBeGreaterThan(0.75);
    expect(calibration.quality.frontBackDifference).toBeLessThan(0.01);
    expect(calibration.quality.sideDifference).toBeLessThan(0.01);
  });
  it("activates metric v3 and uses explicit limb measurements", () => {
    const metricMeasurements: BodyMeasurements = {
      ...measurements,
      shoulderWidthCm: 44,
      armLengthCm: 62,
      upperArmCm: 32,
      thighCm: 58,
      inseamCm: 82,
      forearmCm: 27,
      calfCm: 38,
      neckCm: 39,
      shoulderSlopeDeg: 9,
    };

    const metricCalibration = buildBodyCalibration(
      {
        front: metricSilhouette(front, 0.95),
        back: metricSilhouette(front.map((value) => value * 0.99), 0.93),
        left: metricSilhouette(side, 0.92),
        right: metricSilhouette(side.map((value) => value * 1.01), 0.94),
      },
      metricMeasurements,
    );

    expect(metricCalibration.version).toBe(3);
    expect(metricCalibration.method).toBe("metric-target-anatomical-v3");
    expect(Object.keys(metricCalibration.viewCalibration ?? {})).toHaveLength(4);
    expect(metricCalibration.mesh.version).toBe(3);

    const leftArm = metricCalibration.mesh.collisionPrimitives?.find(
      (primitive) =>
        primitive.type === "tapered-capsule" &&
        primitive.part === "left-arm",
    );
    const leftLeg = metricCalibration.mesh.collisionPrimitives?.find(
      (primitive) =>
        primitive.type === "tapered-capsule" &&
        primitive.part === "left-leg",
    );

    expect(leftArm?.type).toBe("tapered-capsule");
    expect(leftLeg?.type).toBe("tapered-capsule");
    if (!leftArm || leftArm.type !== "tapered-capsule") throw new Error("arm missing");
    if (!leftLeg || leftLeg.type !== "tapered-capsule") throw new Error("leg missing");

    expect(Math.abs(leftArm.start[0])).toBeCloseTo(22, 0);
    expect(leftArm.startRadius).toBeCloseTo(32 / (Math.PI * 2), 1);
    expect(
      Math.hypot(
        leftArm.end[0] - leftArm.start[0],
        leftArm.end[1] - leftArm.start[1],
        leftArm.end[2] - leftArm.start[2],
      ),
    ).toBeCloseTo(62, 0);
    expect(leftLeg.startRadius).toBeCloseTo(58 / (Math.PI * 2), 1);
    expect(leftArm.endRadius).toBeCloseTo(
      (27 / (Math.PI * 2)) * 0.78,
      1,
    );
    expect(leftLeg.endRadius).toBeCloseTo(
      (38 / (Math.PI * 2)) * 0.62,
      1,
    );
    expect(
      metricCalibration.mesh.semanticMeasurements,
    ).toMatchObject({
      shoulderSlopeDeg: 9,
    });
    expect(
      metricCalibration.mesh.semanticMeasurements?.neckRadiusCm ?? 0,
    ).toBeCloseTo(39 / (Math.PI * 2), 1);
  });

  it("builds an asymmetric metric BodyMesh v4 from lateral contour centers", () => {
    const centered = new Array(samples).fill(0);
    const bulge = centered.map((_, index) => {
      const t = index / (samples - 1);
      return t > 0.28 && t < 0.62 ? 0.018 : 0;
    });
    const right = metricSilhouette(side, 0.95);
    const left = metricSilhouette(side, 0.95);
    right.centerProfile = bulge.map((value) => -value);
    left.centerProfile = bulge;

    const detailed = buildBodyCalibration(
      {
        front: metricSilhouette(front, 0.95),
        back: metricSilhouette(front, 0.95),
        right,
        left,
      },
      measurements,
    );

    expect(detailed.mesh.version).toBe(4);
    expect(detailed.mesh.centerZProfile).toHaveLength(samples);
    expect(
      Math.max(...(detailed.mesh.centerZProfile ?? []).map(Math.abs)),
    ).toBeGreaterThan(1);

    const torso = detailed.mesh.collisionPrimitives?.find(
      (primitive) => primitive.type === "elliptical-hull",
    );
    expect(torso?.type).toBe("elliptical-hull");
    if (!torso || torso.type !== "elliptical-hull") {
      throw new Error("torso collision hull missing");
    }
    expect(torso.centerZ).toBeDefined();
    expect(Math.max(...(torso.centerZ ?? []).map(Math.abs))).toBeGreaterThan(1);
  });

});
