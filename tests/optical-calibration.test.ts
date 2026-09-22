import { describe, expect, it } from "vitest";
import {
  scaleOpticalIntrinsics,
  solveOpticalCalibration,
} from "../src/lib/mirro/optical-calibration";
import { distortNormalizedPoint } from "../src/lib/mirro/lens-distortion";
import type {
  BodyViewCalibration,
  CameraExtrinsics,
  CameraIntrinsics,
  LensDistortion,
} from "../src/lib/mirro/types";

const TARGET = {
  magenta: [-7.9, -12.25],
  cyan: [7.9, -12.25],
  yellow: [-7.9, 12.25],
  blue: [7.9, 12.25],
} as const;

function rotation(
  pitch: number,
  yaw: number,
  roll: number,
): CameraExtrinsics["rotation"] {
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);

  const ry = [
    cy, 0, sy,
    0, 1, 0,
    -sy, 0, cy,
  ];
  const rx = [
    1, 0, 0,
    0, cp, -sp,
    0, sp, cp,
  ];
  const rz = [
    cr, -sr, 0,
    sr, cr, 0,
    0, 0, 1,
  ];

  const multiply = (a: number[], b: number[]) => {
    const out = new Array<number>(9).fill(0);
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 3; col += 1) {
        out[row * 3 + col] =
          a[row * 3] * b[col] +
          a[row * 3 + 1] * b[col + 3] +
          a[row * 3 + 2] * b[col + 6];
      }
    }
    return out;
  };

  return multiply(rz, multiply(ry, rx)) as CameraExtrinsics["rotation"];
}

function project(
  intrinsics: CameraIntrinsics,
  distortion: LensDistortion,
  pose: CameraExtrinsics,
) {
  return Object.fromEntries(
    Object.entries(TARGET).map(([name, point]) => {
      const [x, y] = point;
      const r = pose.rotation;
      const t = pose.translation;
      const xc = r[0] * x + r[1] * y + t[0];
      const yc = r[3] * x + r[4] * y + t[1];
      const zc = r[6] * x + r[7] * y + t[2];
      const distorted = distortNormalizedPoint(
        [xc / zc, yc / zc],
        distortion,
      );
      return [
        name,
        [
          intrinsics.fx * distorted[0] + intrinsics.cx,
          intrinsics.fy * distorted[1] + intrinsics.cy,
        ],
      ];
    }),
  ) as BodyViewCalibration["markerCenters"];
}

function frame(
  intrinsics: CameraIntrinsics,
  distortion: LensDistortion,
  pose: CameraExtrinsics,
): BodyViewCalibration {
  const markerCenters = project(
    intrinsics,
    distortion,
    pose,
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
    pixelsPerCm:
      ((top + bottom) / 2 / 15.8 +
        (left + right) / 2 / 24.5) /
      2,
    rollRadians: 0,
    perspectiveSkew:
      Math.abs(top - bottom) /
        Math.max(1, top + bottom) +
      Math.abs(left - right) /
        Math.max(1, left + right),
    score: 0.98,
    imageWidth: 900,
    imageHeight: 1200,
    targetBounds: {
      x: 120,
      y: 160,
      width: 620,
      height: 820,
    },
    markerCenters,
  };
}

describe("dedicated optical calibration", () => {
  it("solves shared intrinsics and Brown-Conrady distortion over many target poses", () => {
    const intrinsics: CameraIntrinsics = {
      fx: 1030,
      fy: 1005,
      cx: 448,
      cy: 602,
      skew: 0,
    };
    const distortion: LensDistortion = {
      k1: -0.21,
      k2: 0.055,
      k3: -0.008,
      p1: 0.004,
      p2: -0.003,
    };
    const poses: CameraExtrinsics[] = [
      { rotation: rotation(0.18, -0.2, 0.04), translation: [-10, -5, 67] },
      { rotation: rotation(-0.22, 0.26, -0.05), translation: [12, 6, 70] },
      { rotation: rotation(0.31, 0.12, 0.08), translation: [-8, 11, 62] },
      { rotation: rotation(-0.28, -0.17, -0.07), translation: [9, -10, 64] },
      { rotation: rotation(0.14, 0.34, -0.1), translation: [-15, 3, 72] },
      { rotation: rotation(-0.35, 0.08, 0.09), translation: [14, -2, 69] },
      { rotation: rotation(0.27, -0.31, 0.02), translation: [2, 13, 66] },
      { rotation: rotation(-0.16, 0.21, -0.11), translation: [-3, -13, 68] },
    ];

    const solved = solveOpticalCalibration(
      poses.map((pose) =>
        frame(intrinsics, distortion, pose),
      ),
    );

    expect(solved.frameCount).toBe(8);
    expect(solved.rmsReprojectionErrorPx).toBeLessThan(5);
    expect(solved.conditionScore).toBeGreaterThan(0.2);
    expect(solved.intrinsics.fx).toBeGreaterThan(650);
    expect(solved.intrinsics.fx).toBeLessThan(1600);
    expect(solved.intrinsics.fy).toBeGreaterThan(650);
    expect(solved.intrinsics.fy).toBeLessThan(1600);
    expect(Math.sign(solved.distortion.k1)).toBe(
      Math.sign(distortion.k1),
    );
    expect(solved.frames.every((item) =>
      Number.isFinite(item.reprojectionErrorPx),
    )).toBe(true);
  });

  it("scales intrinsic parameters with the calibrated frame", () => {
    const scaled = scaleOpticalIntrinsics(
      {
        fx: 1000,
        fy: 980,
        cx: 450,
        cy: 600,
        skew: 0,
      },
      { width: 900, height: 1200 },
      { width: 450, height: 600 },
    );

    expect(scaled.fx).toBe(500);
    expect(scaled.fy).toBe(490);
    expect(scaled.cx).toBe(225);
    expect(scaled.cy).toBe(300);
  });
});
