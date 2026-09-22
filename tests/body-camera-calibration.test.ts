import { describe, expect, it } from "vitest";
import {
  applyMetricViewCalibration,
  detectBodyViewCalibration,
} from "../src/lib/mirro/body-camera-calibration";
import type { RgbaImage } from "../src/lib/mirro/body-calibration";
import {
  rectifySilhouetteWithPinhole,
  solveBodyCameraRig,
} from "../src/lib/mirro/camera-rig";
import {
  distortNormalizedPoint,
  estimateLensDistortion,
  undistortNormalizedPoint,
} from "../src/lib/mirro/lens-distortion";
import type {
  BodyCameraRig,
  BodySide,
  BodySilhouette,
  BodyViewCalibration,
  CameraExtrinsics,
  CameraIntrinsics,
  LensDistortion,
} from "../src/lib/mirro/types";

function syntheticTarget(): RgbaImage {
  const width = 210;
  const height = 297;
  const data = new Uint8ClampedArray(width * height * 4);

  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const offset = pixel * 4;
    data[offset] = 250;
    data[offset + 1] = 250;
    data[offset + 2] = 250;
    data[offset + 3] = 255;
  }

  const markers = [
    { center: [26, 26], rgb: [214, 0, 143] },
    { center: [184, 26], rgb: [0, 166, 214] },
    { center: [26, 271], rgb: [246, 200, 0] },
    { center: [184, 271], rgb: [64, 84, 255] },
  ] as const;

  for (const marker of markers) {
    for (let y = marker.center[1] - 8; y <= marker.center[1] + 8; y += 1) {
      for (let x = marker.center[0] - 8; x <= marker.center[0] + 8; x += 1) {
        const offset = (y * width + x) * 4;
        data[offset] = marker.rgb[0];
        data[offset + 1] = marker.rgb[1];
        data[offset + 2] = marker.rgb[2];
        data[offset + 3] = 255;
      }
    }
  }

  return { width, height, data };
}

describe("body metric target", () => {
  it("recovers pixels-per-centimeter and orientation from the printable A4 target", () => {
    const calibration = detectBodyViewCalibration(syntheticTarget());

    expect(calibration).not.toBeNull();
    expect(calibration?.pixelsPerCm).toBeCloseTo(10, 1);
    expect(calibration?.rollRadians).toBeCloseTo(0, 4);
    expect(calibration?.perspectiveSkew).toBeLessThan(0.02);
    expect(calibration?.score).toBeGreaterThan(0.95);
  });

  it("converts normalized silhouette widths into observed centimeters", () => {
    const calibration = detectBodyViewCalibration(syntheticTarget());
    if (!calibration) throw new Error("target not detected");

    const silhouette: BodySilhouette = {
      sourceWidth: 300,
      sourceHeight: 400,
      bounds: { x: 50, y: 100, width: 120, height: 200 },
      widthProfile: [0.2, 0.3, 0.4],
      foregroundRatio: 0.25,
      backgroundThreshold: 40,
      confidence: 0.9,
    };

    const metric = applyMetricViewCalibration(silhouette, calibration);

    expect(metric.metricBodyHeightCm).toBeCloseTo(20, 1);
    expect(metric.metricWidthProfileCm?.[0]).toBeCloseTo(4, 1);
    expect(metric.metricWidthProfileCm?.[2]).toBeCloseTo(8, 1);
    expect(metric.viewCalibration?.method).toBe("mirro-a4-color-target-v1");
  });
});


function multiplyRotation(
  pitch: number,
  yaw: number,
): CameraExtrinsics["rotation"] {
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);

  return [
    cy, sy * sp, sy * cp,
    0, cp, -sp,
    -sy, cy * sp, cy * cp,
  ];
}

function projectTarget(
  intrinsics: CameraIntrinsics,
  extrinsics: CameraExtrinsics,
  distortion?: LensDistortion,
) {
  const world = {
    magenta: [-7.9, -12.25],
    cyan: [7.9, -12.25],
    yellow: [-7.9, 12.25],
    blue: [7.9, 12.25],
  } as const;

  return Object.fromEntries(
    Object.entries(world).map(([name, point]) => {
      const [x, y] = point;
      const r = extrinsics.rotation;
      const t = extrinsics.translation;
      const xc = r[0] * x + r[1] * y + t[0];
      const yc = r[3] * x + r[4] * y + t[1];
      const zc = r[6] * x + r[7] * y + t[2];
      const xn = xc / zc;
      const yn = yc / zc;
      const projected = distortion
        ? distortNormalizedPoint([xn, yn], distortion)
        : [xn, yn];
      return [
        name,
        [
          intrinsics.fx * projected[0] + intrinsics.cx,
          intrinsics.fy * projected[1] + intrinsics.cy,
        ],
      ];
    }),
  ) as BodyViewCalibration["markerCenters"];
}

function syntheticView(
  side: BodySide,
  intrinsics: CameraIntrinsics,
  pitch: number,
  yaw: number,
  translation: [number, number, number],
  distortion?: LensDistortion,
): BodyViewCalibration {
  const extrinsics: CameraExtrinsics = {
    rotation: multiplyRotation(pitch, yaw),
    translation,
  };
  const markerCenters = projectTarget(
    intrinsics,
    extrinsics,
    distortion,
  );
  const top = Math.hypot(
    markerCenters.cyan[0] - markerCenters.magenta[0],
    markerCenters.cyan[1] - markerCenters.magenta[1],
  );
  const bottom = Math.hypot(
    markerCenters.blue[0] - markerCenters.yellow[0],
    markerCenters.blue[1] - markerCenters.yellow[1],
  );
  const left = Math.hypot(
    markerCenters.yellow[0] - markerCenters.magenta[0],
    markerCenters.yellow[1] - markerCenters.magenta[1],
  );
  const right = Math.hypot(
    markerCenters.blue[0] - markerCenters.cyan[0],
    markerCenters.blue[1] - markerCenters.cyan[1],
  );

  return {
    method: "mirro-a4-color-target-v1",
    pixelsPerCm: ((top + bottom) / 2 / 15.8 + (left + right) / 2 / 24.5) / 2,
    rollRadians: 0,
    perspectiveSkew:
      Math.abs(top - bottom) / Math.max(1, top + bottom) +
      Math.abs(left - right) / Math.max(1, left + right),
    score: 0.96,
    imageWidth: 900,
    imageHeight: 1200,
    targetBounds: { x: 200, y: 300, width: 420, height: 560 },
    markerCenters,
  };
}


describe("pinhole silhouette rectification", () => {
  it("converts pixel widths through the inverse target homography", () => {
    const silhouette: BodySilhouette = {
      sourceWidth: 300,
      sourceHeight: 400,
      bounds: { x: 50, y: 100, width: 100, height: 200 },
      widthProfile: [0.5, 0.5, 0.5],
      foregroundRatio: 0.25,
      backgroundThreshold: 40,
      confidence: 0.95,
      metricWidthProfileCm: [10, 10, 10],
      metricBodyHeightCm: 20,
    };
    const calibration: BodyViewCalibration = {
      method: "mirro-a4-pinhole-v2",
      pixelsPerCm: 10,
      rollRadians: 0,
      perspectiveSkew: 0,
      score: 1,
      imageWidth: 300,
      imageHeight: 400,
      homography: [
        10, 0, 100,
        0, 10, 200,
        0, 0, 1,
      ],
      targetBounds: { x: 21, y: 77, width: 158, height: 245 },
      markerCenters: {
        magenta: [21, 77],
        cyan: [179, 77],
        yellow: [21, 322],
        blue: [179, 322],
      },
    };

    const rectified = rectifySilhouetteWithPinhole(
      silhouette,
      calibration,
    );

    expect(rectified.metricWidthProfileCm).toEqual(
      expect.arrayContaining([
        expect.closeTo(10, 1),
        expect.closeTo(10, 1),
        expect.closeTo(10, 1),
      ]),
    );
    expect(rectified.metricBodyHeightCm).toBeCloseTo(20, 0);
  });
});

describe("shared pinhole camera rig", () => {
  it("refines shared intrinsics and per-view extrinsics from four target views", () => {
    const expected: CameraIntrinsics = {
      fx: 1050,
      fy: 1020,
      cx: 450,
      cy: 600,
      skew: 0,
    };

    const views: Record<BodySide, BodyViewCalibration> = {
      front: syntheticView("front", expected, 0.12, -0.11, [0.5, -0.4, 92]),
      right: syntheticView("right", expected, 0.23, 0.19, [-1.3, 0.7, 96]),
      back: syntheticView("back", expected, -0.17, -0.24, [0.9, 0.2, 89]),
      left: syntheticView("left", expected, -0.25, 0.14, [-0.6, -0.9, 94]),
    };

    const solved = solveBodyCameraRig(views);

    expect(solved.rig.method).toBe("shared-pinhole-bundle-v1");
    expect(solved.rig.rmsReprojectionErrorPx).toBeLessThan(2.5);
    expect(solved.rig.intrinsics.fx).toBeGreaterThan(600);
    expect(solved.rig.intrinsics.fx).toBeLessThan(1800);
    expect(solved.rig.intrinsics.fy).toBeGreaterThan(600);
    expect(solved.rig.intrinsics.fy).toBeLessThan(1800);
    expect(Math.abs(solved.rig.intrinsics.cx - expected.cx)).toBeLessThan(120);
    expect(Math.abs(solved.rig.intrinsics.cy - expected.cy)).toBeLessThan(150);
    expect(solved.rig.iterations).toBeGreaterThan(0);

    for (const side of ["front", "right", "back", "left"] as const) {
      expect(solved.calibrations[side].method).toBe("mirro-a4-pinhole-v2");
      expect(solved.calibrations[side].homography).toHaveLength(9);
      expect(solved.calibrations[side].extrinsics?.translation[2]).toBeGreaterThan(0);
      expect(solved.calibrations[side].reprojectionErrorPx).toBeLessThan(3);
    }
  });
});

describe("Brown-Conrady lens calibration", () => {
  it("recovers a useful distortion field and reduces reprojection RMS", () => {
    const intrinsics: CameraIntrinsics = {
      fx: 980,
      fy: 965,
      cx: 450,
      cy: 600,
      skew: 0,
    };
    const expected: LensDistortion = {
      k1: -0.28,
      k2: 0.09,
      k3: -0.015,
      p1: 0.006,
      p2: -0.004,
    };
    const poses: Record<BodySide, CameraExtrinsics> = {
      front: {
        rotation: multiplyRotation(0.18, -0.2),
        translation: [10, 4, 58],
      },
      right: {
        rotation: multiplyRotation(0.28, 0.24),
        translation: [-12, 8, 62],
      },
      back: {
        rotation: multiplyRotation(-0.22, -0.3),
        translation: [8, -7, 56],
      },
      left: {
        rotation: multiplyRotation(-0.3, 0.18),
        translation: [-9, -5, 60],
      },
    };
    const calibrations = Object.fromEntries(
      (["front", "right", "back", "left"] as const).map((side) => [
        side,
        syntheticView(
          side,
          intrinsics,
          0,
          0,
          poses[side].translation,
          expected,
        ),
      ]),
    ) as Record<BodySide, BodyViewCalibration>;

    for (const side of ["front", "right", "back", "left"] as const) {
      calibrations[side].markerCenters = projectTarget(
        intrinsics,
        poses[side],
        expected,
      );
    }

    const rig: BodyCameraRig = {
      version: 1,
      method: "shared-pinhole-bundle-v1",
      intrinsics,
      views: Object.fromEntries(
        (["front", "right", "back", "left"] as const).map((side) => [
          side,
          {
            ...poses[side],
            homography: [1, 0, 0, 0, 1, 0, 0, 0, 1],
            reprojectionErrorPx: 0,
          },
        ]),
      ) as BodyCameraRig["views"],
      rmsReprojectionErrorPx: 0,
      iterations: 0,
      conditionScore: 1,
      warnings: [],
    };

    const solved = estimateLensDistortion(calibrations, rig);

    expect(solved.improvementPx).toBeGreaterThan(0.2);
    expect(solved.distortedRmsPx).toBeLessThan(
      solved.baselineRmsPx * 0.7,
    );
    expect(Math.sign(solved.distortion.k1)).toBe(
      Math.sign(expected.k1),
    );
    expect(Math.abs(solved.distortion.p1)).toBeGreaterThan(0.0005);

    const point: [number, number] = [0.35, -0.22];
    const distorted = distortNormalizedPoint(point, expected);
    const recovered = undistortNormalizedPoint(distorted, expected);
    expect(recovered[0]).toBeCloseTo(point[0], 5);
    expect(recovered[1]).toBeCloseTo(point[1], 5);
  });
});
