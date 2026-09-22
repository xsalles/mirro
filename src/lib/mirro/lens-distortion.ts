import type {
  BodyCameraRig,
  BodySide,
  BodyViewCalibration,
  CameraExtrinsics,
  CameraIntrinsics,
  LensDistortion,
} from "./types";
import type { RgbaImage } from "./body-calibration";

type Point2 = [number, number];

const SIDES: BodySide[] = ["front", "right", "back", "left"];
const TARGET_POINTS_CM = {
  magenta: [-7.9, -12.25],
  cyan: [7.9, -12.25],
  yellow: [-7.9, 12.25],
  blue: [7.9, 12.25],
} as const;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function solveLinearSystem(matrix: number[][], rhs: number[]) {
  const n = rhs.length;
  const augmented = matrix.map((row, index) => [...row, rhs[index]]);

  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(augmented[row][col]) > Math.abs(augmented[pivot][col])) {
        pivot = row;
      }
    }
    if (Math.abs(augmented[pivot][col]) < 1e-12) {
      throw new Error("Sistema de distorção degenerado.");
    }
    [augmented[col], augmented[pivot]] = [augmented[pivot], augmented[col]];

    const divisor = augmented[col][col];
    for (let k = col; k <= n; k += 1) augmented[col][k] /= divisor;

    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = augmented[row][col];
      for (let k = col; k <= n; k += 1) {
        augmented[row][k] -= factor * augmented[col][k];
      }
    }
  }

  return augmented.map((row) => row[n]);
}

function pixelToNormalized(
  point: Point2,
  intrinsics: CameraIntrinsics,
): Point2 {
  const y = (point[1] - intrinsics.cy) / intrinsics.fy;
  const x =
    (point[0] - intrinsics.cx - intrinsics.skew * y) /
    intrinsics.fx;
  return [x, y];
}

function normalizedToPixel(
  point: Point2,
  intrinsics: CameraIntrinsics,
): Point2 {
  return [
    intrinsics.fx * point[0] +
      intrinsics.skew * point[1] +
      intrinsics.cx,
    intrinsics.fy * point[1] + intrinsics.cy,
  ];
}

function idealNormalizedPoint(
  point: readonly [number, number],
  extrinsics: CameraExtrinsics,
): Point2 {
  const [x, y] = point;
  const r = extrinsics.rotation;
  const t = extrinsics.translation;
  const xc = r[0] * x + r[1] * y + t[0];
  const yc = r[3] * x + r[4] * y + t[1];
  const zc = r[6] * x + r[7] * y + t[2];
  const safeZ = Math.abs(zc) < 1e-9 ? 1e-9 : zc;
  return [xc / safeZ, yc / safeZ];
}

export function distortNormalizedPoint(
  point: Point2,
  distortion: LensDistortion,
): Point2 {
  const [x, y] = point;
  const r2 = x * x + y * y;
  const r4 = r2 * r2;
  const r6 = r4 * r2;
  const radial =
    1 +
    distortion.k1 * r2 +
    distortion.k2 * r4 +
    distortion.k3 * r6;
  return [
    x * radial +
      2 * distortion.p1 * x * y +
      distortion.p2 * (r2 + 2 * x * x),
    y * radial +
      distortion.p1 * (r2 + 2 * y * y) +
      2 * distortion.p2 * x * y,
  ];
}

export function undistortNormalizedPoint(
  distorted: Point2,
  distortion: LensDistortion,
  iterations = 8,
): Point2 {
  let estimate: Point2 = [...distorted];

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const projected = distortNormalizedPoint(estimate, distortion);
    estimate = [
      estimate[0] + distorted[0] - projected[0],
      estimate[1] + distorted[1] - projected[1],
    ];
  }

  return estimate;
}

function markerEntries(calibration: BodyViewCalibration) {
  return (
    ["magenta", "cyan", "yellow", "blue"] as const
  ).map((name) => ({
    name,
    world: TARGET_POINTS_CM[name],
    observed: calibration.markerCenters[name],
  }));
}

function reprojectionRms(
  calibrations: Record<BodySide, BodyViewCalibration>,
  rig: BodyCameraRig,
  distortion?: LensDistortion,
) {
  let squared = 0;
  let count = 0;

  for (const side of SIDES) {
    for (const marker of markerEntries(calibrations[side])) {
      const ideal = idealNormalizedPoint(
        marker.world,
        rig.views[side],
      );
      const projected = normalizedToPixel(
        distortion
          ? distortNormalizedPoint(ideal, distortion)
          : ideal,
        rig.intrinsics,
      );
      squared +=
        (projected[0] - marker.observed[0]) ** 2 +
        (projected[1] - marker.observed[1]) ** 2;
      count += 1;
    }
  }

  return Math.sqrt(squared / Math.max(1, count));
}

export function estimateLensDistortion(
  calibrations: Record<BodySide, BodyViewCalibration>,
  rig: BodyCameraRig,
): {
  distortion: LensDistortion;
  baselineRmsPx: number;
  distortedRmsPx: number;
  improvementPx: number;
  score: number;
} {
  const rows: number[][] = [];
  const values: number[] = [];

  for (const side of SIDES) {
    for (const marker of markerEntries(calibrations[side])) {
      const [x, y] = idealNormalizedPoint(
        marker.world,
        rig.views[side],
      );
      const [xd, yd] = pixelToNormalized(
        marker.observed,
        rig.intrinsics,
      );
      const r2 = x * x + y * y;
      const r4 = r2 * r2;
      const r6 = r4 * r2;

      rows.push([
        x * r2,
        x * r4,
        x * r6,
        2 * x * y,
        r2 + 2 * x * x,
      ]);
      values.push(xd - x);

      rows.push([
        y * r2,
        y * r4,
        y * r6,
        r2 + 2 * y * y,
        2 * x * y,
      ]);
      values.push(yd - y);
    }
  }

  const ata = Array.from({ length: 5 }, () =>
    new Array<number>(5).fill(0),
  );
  const atb = new Array<number>(5).fill(0);
  const regularization = [0.004, 0.012, 0.04, 0.02, 0.02];

  for (let row = 0; row < rows.length; row += 1) {
    for (let i = 0; i < 5; i += 1) {
      atb[i] += rows[row][i] * values[row];
      for (let j = 0; j < 5; j += 1) {
        ata[i][j] += rows[row][i] * rows[row][j];
      }
    }
  }

  for (let i = 0; i < 5; i += 1) {
    ata[i][i] += regularization[i];
  }

  let solved = [0, 0, 0, 0, 0];
  try {
    solved = solveLinearSystem(ata, atb);
  } catch {
    // Zero distortion is the honest fallback for a degenerate target set.
  }

  const distortion: LensDistortion = {
    k1: clamp(solved[0], -0.6, 0.6),
    k2: clamp(solved[1], -0.45, 0.45),
    k3: clamp(solved[2], -0.25, 0.25),
    p1: clamp(solved[3], -0.08, 0.08),
    p2: clamp(solved[4], -0.08, 0.08),
  };

  const baselineRmsPx = reprojectionRms(calibrations, rig);
  const distortedRmsPx = reprojectionRms(
    calibrations,
    rig,
    distortion,
  );
  const improvementPx = baselineRmsPx - distortedRmsPx;
  const magnitude =
    Math.abs(distortion.k1) +
    Math.abs(distortion.k2) * 0.6 +
    Math.abs(distortion.k3) * 0.35 +
    (Math.abs(distortion.p1) + Math.abs(distortion.p2)) * 2;
  const score = clamp(
    Math.max(0, improvementPx) / Math.max(0.5, baselineRmsPx) *
      clamp(magnitude * 8, 0, 1),
    0,
    1,
  );

  return {
    distortion,
    baselineRmsPx,
    distortedRmsPx,
    improvementPx,
    score,
  };
}

export function undistortCalibrationMarkers(
  calibrations: Record<BodySide, BodyViewCalibration>,
  intrinsics: CameraIntrinsics,
  distortion: LensDistortion,
) {
  return Object.fromEntries(
    SIDES.map((side) => {
      const calibration = calibrations[side];
      const markerCenters = Object.fromEntries(
        markerEntries(calibration).map((marker) => {
          const normalized = pixelToNormalized(
            marker.observed,
            intrinsics,
          );
          const undistorted = undistortNormalizedPoint(
            normalized,
            distortion,
          );
          return [
            marker.name,
            normalizedToPixel(undistorted, intrinsics),
          ];
        }),
      ) as BodyViewCalibration["markerCenters"];

      return [
        side,
        {
          ...calibration,
          markerCenters,
        },
      ];
    }),
  ) as Record<BodySide, BodyViewCalibration>;
}

function bilinearSample(
  image: RgbaImage,
  x: number,
  y: number,
): [number, number, number, number] {
  if (
    x < 0 ||
    y < 0 ||
    x > image.width - 1 ||
    y > image.height - 1
  ) {
    return [0, 0, 0, 0];
  }

  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(image.width - 1, x0 + 1);
  const y1 = Math.min(image.height - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;

  const sample = (px: number, py: number) => {
    const offset = (py * image.width + px) * 4;
    return [
      image.data[offset],
      image.data[offset + 1],
      image.data[offset + 2],
      image.data[offset + 3],
    ] as const;
  };

  const a = sample(x0, y0);
  const b = sample(x1, y0);
  const c = sample(x0, y1);
  const d = sample(x1, y1);
  const result = [0, 0, 0, 0];

  for (let channel = 0; channel < 4; channel += 1) {
    const top = a[channel] + (b[channel] - a[channel]) * tx;
    const bottom = c[channel] + (d[channel] - c[channel]) * tx;
    result[channel] = top + (bottom - top) * ty;
  }

  return result as [number, number, number, number];
}

export function undistortRgbaImage(
  image: RgbaImage,
  intrinsics: CameraIntrinsics,
  distortion: LensDistortion,
): RgbaImage {
  const data = new Uint8ClampedArray(image.data.length);

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const undistortedNormalized = pixelToNormalized(
        [x, y],
        intrinsics,
      );
      const distortedNormalized = distortNormalizedPoint(
        undistortedNormalized,
        distortion,
      );
      const source = normalizedToPixel(
        distortedNormalized,
        intrinsics,
      );
      const sample = bilinearSample(image, source[0], source[1]);
      const offset = (y * image.width + x) * 4;
      data[offset] = sample[0];
      data[offset + 1] = sample[1];
      data[offset + 2] = sample[2];
      data[offset + 3] = sample[3];
    }
  }

  return {
    width: image.width,
    height: image.height,
    data,
  };
}
