import {
  decomposeHomography,
  solvePlanarHomography,
} from "./camera-rig";
import {
  distortNormalizedPoint,
  undistortNormalizedPoint,
} from "./lens-distortion";
import { detectBodyViewCalibration } from "./body-camera-calibration";
import { decodeForCalibration } from "./image-processing";
import type {
  BodyViewCalibration,
  CameraExtrinsics,
  CameraIntrinsics,
  LensDistortion,
  OpticalCalibrationFrame,
  OpticalCalibrationProfile,
} from "./types";

type Point2 = [number, number];
type Vec3 = [number, number, number];
type Mat3 = [
  number, number, number,
  number, number, number,
  number, number, number
];

const TARGET_POINTS_CM = {
  magenta: [-7.9, -12.25],
  cyan: [7.9, -12.25],
  yellow: [-7.9, 12.25],
  blue: [7.9, 12.25],
} as const;

const TARGET_NAMES = [
  "magenta",
  "cyan",
  "yellow",
  "blue",
] as const;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

function dot(a: Vec3, b: Vec3) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function applyKInverse(
  intrinsics: CameraIntrinsics,
  h: Vec3,
): Vec3 {
  const y = (h[1] - intrinsics.cy * h[2]) / intrinsics.fy;
  const x =
    (h[0] - intrinsics.cx * h[2] - intrinsics.skew * y) /
    intrinsics.fx;
  return [x, y, h[2]];
}

function homographyColumns(h: Mat3) {
  return {
    h1: [h[0], h[3], h[6]] as Vec3,
    h2: [h[1], h[4], h[7]] as Vec3,
  };
}

function orthonormalityResidual(
  homography: Mat3,
  intrinsics: CameraIntrinsics,
) {
  const { h1, h2 } = homographyColumns(homography);
  const q1 = applyKInverse(intrinsics, h1);
  const q2 = applyKInverse(intrinsics, h2);
  const n1 = Math.hypot(...q1);
  const n2 = Math.hypot(...q2);
  const r1 = normalize(q1);
  const r2 = normalize(q2);
  return dot(r1, r2) ** 2 + ((n1 - n2) / Math.max(1e-6, n1 + n2)) ** 2;
}

function markerPairs(calibration: BodyViewCalibration) {
  return TARGET_NAMES.map((name) => ({
    world: TARGET_POINTS_CM[name],
    image: calibration.markerCenters[name],
  }));
}

function projectPoint(
  point: readonly [number, number],
  intrinsics: CameraIntrinsics,
  extrinsics: CameraExtrinsics,
): Point2 {
  const [x, y] = point;
  const r = extrinsics.rotation;
  const t = extrinsics.translation;
  const xc = r[0] * x + r[1] * y + t[0];
  const yc = r[3] * x + r[4] * y + t[1];
  const zc = r[6] * x + r[7] * y + t[2];
  const safeZ = Math.abs(zc) < 1e-9 ? 1e-9 : zc;
  const xn = xc / safeZ;
  const yn = yc / safeZ;
  return [
    intrinsics.fx * xn +
      intrinsics.skew * yn +
      intrinsics.cx,
    intrinsics.fy * yn + intrinsics.cy,
  ];
}

function reprojectionError(
  calibration: BodyViewCalibration,
  intrinsics: CameraIntrinsics,
  extrinsics: CameraExtrinsics,
) {
  let squared = 0;
  for (const pair of markerPairs(calibration)) {
    const projected = projectPoint(
      pair.world,
      intrinsics,
      extrinsics,
    );
    squared +=
      (projected[0] - pair.image[0]) ** 2 +
      (projected[1] - pair.image[1]) ** 2;
  }
  return Math.sqrt(squared / TARGET_NAMES.length);
}

function multiplyMat3(a: Mat3, b: Mat3): Mat3 {
  const out = new Array<number>(9).fill(0);
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      out[row * 3 + col] =
        a[row * 3] * b[col] +
        a[row * 3 + 1] * b[3 + col] +
        a[row * 3 + 2] * b[6 + col];
    }
  }
  return out as Mat3;
}

function deltaRotation(axis: 0 | 1 | 2, angle: number): Mat3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  if (axis === 0) {
    return [
      1, 0, 0,
      0, c, -s,
      0, s, c,
    ];
  }
  if (axis === 1) {
    return [
      c, 0, s,
      0, 1, 0,
      -s, 0, c,
    ];
  }
  return [
    c, -s, 0,
    s, c, 0,
    0, 0, 1,
  ];
}

function refinePose(
  calibration: BodyViewCalibration,
  intrinsics: CameraIntrinsics,
  initial: CameraExtrinsics,
) {
  let pose: CameraExtrinsics = {
    rotation: [...initial.rotation],
    translation: [...initial.translation],
  };
  let best = reprojectionError(calibration, intrinsics, pose);
  let iterations = 0;
  const distance = Math.max(20, pose.translation[2]);

  for (const [angleStep, translationScale] of [
    [0.03, 0.016],
    [0.012, 0.006],
    [0.004, 0.0025],
    [0.0015, 0.0009],
  ] as const) {
    let improved = true;
    let passes = 0;

    while (improved && passes < 7) {
      improved = false;
      passes += 1;
      const candidates: CameraExtrinsics[] = [];

      for (const direction of [-1, 1] as const) {
        for (const axis of [0, 1, 2] as const) {
          candidates.push({
            rotation: multiplyMat3(
              deltaRotation(axis, angleStep * direction),
              pose.rotation as Mat3,
            ),
            translation: [...pose.translation],
          });
        }

        for (const axis of [0, 1, 2] as const) {
          const translation = [...pose.translation] as [
            number,
            number,
            number,
          ];
          translation[axis] +=
            distance * translationScale * direction;
          translation[2] = Math.max(5, translation[2]);
          candidates.push({
            rotation: [...pose.rotation],
            translation,
          });
        }
      }

      for (const candidate of candidates) {
        iterations += 1;
        const error = reprojectionError(
          calibration,
          intrinsics,
          candidate,
        );
        if (error + 1e-8 < best) {
          best = error;
          pose = candidate;
          improved = true;
        }
      }
    }
  }

  return { pose, error: best, iterations };
}

function buildHomography(calibration: BodyViewCalibration): Mat3 {
  const pairs = markerPairs(calibration);
  return solvePlanarHomography(
    pairs.map((pair) => [...pair.world] as Point2),
    pairs.map((pair) => pair.image),
  );
}

function intrinsicsObjective(
  calibrations: BodyViewCalibration[],
  homographies: Mat3[],
  intrinsics: CameraIntrinsics,
) {
  let reprojection = 0;
  let orthogonality = 0;

  for (let index = 0; index < calibrations.length; index += 1) {
    const pose = decomposeHomography(
      homographies[index],
      intrinsics,
    );
    const error = reprojectionError(
      calibrations[index],
      intrinsics,
      pose,
    );
    reprojection += error * error;
    orthogonality += orthonormalityResidual(
      homographies[index],
      intrinsics,
    );
  }

  const width = calibrations[0].imageWidth ?? 900;
  const height = calibrations[0].imageHeight ?? 900;
  const principalPrior =
    ((intrinsics.cx - width / 2) / Math.max(1, width)) ** 2 +
    ((intrinsics.cy - height / 2) / Math.max(1, height)) ** 2;
  const aspectPrior =
    Math.log(Math.max(1e-6, intrinsics.fx / intrinsics.fy)) ** 2;

  return (
    reprojection / calibrations.length +
    orthogonality * 210 +
    principalPrior * 2.5 +
    aspectPrior * 0.35
  );
}

function refineSharedIntrinsics(
  calibrations: BodyViewCalibration[],
  homographies: Mat3[],
) {
  const width = calibrations[0].imageWidth ?? 900;
  const height = calibrations[0].imageHeight ?? 900;
  const maxDimension = Math.max(width, height);

  let intrinsics: CameraIntrinsics = {
    fx: maxDimension * 1.18,
    fy: maxDimension * 1.18,
    cx: width / 2,
    cy: height / 2,
    skew: 0,
  };
  let best = intrinsicsObjective(
    calibrations,
    homographies,
    intrinsics,
  );
  let iterations = 0;

  for (const scale of [0.24, 0.11, 0.05, 0.022, 0.009, 0.004]) {
    let improved = true;
    let passes = 0;
    while (improved && passes < 10) {
      improved = false;
      passes += 1;
      const focalStep = maxDimension * scale;
      const centerStep = maxDimension * scale * 0.22;
      const candidates: CameraIntrinsics[] = [];

      for (const direction of [-1, 1] as const) {
        candidates.push({
          ...intrinsics,
          fx: clamp(
            intrinsics.fx + focalStep * direction,
            maxDimension * 0.3,
            maxDimension * 5,
          ),
        });
        candidates.push({
          ...intrinsics,
          fy: clamp(
            intrinsics.fy + focalStep * 0.75 * direction,
            maxDimension * 0.3,
            maxDimension * 5,
          ),
        });
        candidates.push({
          ...intrinsics,
          cx: clamp(
            intrinsics.cx + centerStep * direction,
            width * 0.2,
            width * 0.8,
          ),
        });
        candidates.push({
          ...intrinsics,
          cy: clamp(
            intrinsics.cy + centerStep * direction,
            height * 0.2,
            height * 0.8,
          ),
        });
      }

      for (const candidate of candidates) {
        iterations += 1;
        const score = intrinsicsObjective(
          calibrations,
          homographies,
          candidate,
        );
        if (score + 1e-9 < best) {
          best = score;
          intrinsics = candidate;
          improved = true;
        }
      }
    }
  }

  return { intrinsics, iterations };
}

function solveLinearSystem(matrix: number[][], rhs: number[]) {
  const n = rhs.length;
  const augmented = matrix.map((row, index) => [
    ...row,
    rhs[index],
  ]);

  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (
        Math.abs(augmented[row][col]) >
        Math.abs(augmented[pivot][col])
      ) {
        pivot = row;
      }
    }
    if (Math.abs(augmented[pivot][col]) < 1e-12) {
      throw new Error("Calibração óptica degenerada.");
    }
    [augmented[col], augmented[pivot]] = [
      augmented[pivot],
      augmented[col],
    ];
    const divisor = augmented[col][col];
    for (let k = col; k <= n; k += 1) {
      augmented[col][k] /= divisor;
    }
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

function idealNormalizedPoint(
  point: readonly [number, number],
  pose: CameraExtrinsics,
): Point2 {
  const [x, y] = point;
  const r = pose.rotation;
  const t = pose.translation;
  const xc = r[0] * x + r[1] * y + t[0];
  const yc = r[3] * x + r[4] * y + t[1];
  const zc = r[6] * x + r[7] * y + t[2];
  const safeZ = Math.abs(zc) < 1e-9 ? 1e-9 : zc;
  return [xc / safeZ, yc / safeZ];
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

function fitDistortion(
  calibrations: BodyViewCalibration[],
  poses: CameraExtrinsics[],
  intrinsics: CameraIntrinsics,
): LensDistortion {
  const rows: number[][] = [];
  const values: number[] = [];

  for (let frame = 0; frame < calibrations.length; frame += 1) {
    for (const pair of markerPairs(calibrations[frame])) {
      const [x, y] = idealNormalizedPoint(
        pair.world,
        poses[frame],
      );
      const [xd, yd] = pixelToNormalized(
        pair.image,
        intrinsics,
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
  const regularization = [0.0025, 0.008, 0.025, 0.012, 0.012];

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
    // Zero distortion is safer than inventing coefficients.
  }

  return {
    k1: clamp(solved[0], -0.7, 0.7),
    k2: clamp(solved[1], -0.5, 0.5),
    k3: clamp(solved[2], -0.3, 0.3),
    p1: clamp(solved[3], -0.08, 0.08),
    p2: clamp(solved[4], -0.08, 0.08),
  };
}

function distortedReprojectionError(
  calibration: BodyViewCalibration,
  intrinsics: CameraIntrinsics,
  pose: CameraExtrinsics,
  distortion: LensDistortion,
) {
  let squared = 0;
  for (const pair of markerPairs(calibration)) {
    const ideal = idealNormalizedPoint(pair.world, pose);
    const distorted = distortNormalizedPoint(
      ideal,
      distortion,
    );
    const predicted: Point2 = [
      intrinsics.fx * distorted[0] +
        intrinsics.skew * distorted[1] +
        intrinsics.cx,
      intrinsics.fy * distorted[1] + intrinsics.cy,
    ];
    squared +=
      (predicted[0] - pair.image[0]) ** 2 +
      (predicted[1] - pair.image[1]) ** 2;
  }
  return Math.sqrt(squared / TARGET_NAMES.length);
}

function undistortCalibration(
  calibration: BodyViewCalibration,
  intrinsics: CameraIntrinsics,
  distortion: LensDistortion,
): BodyViewCalibration {
  const markerCenters = Object.fromEntries(
    TARGET_NAMES.map((name) => {
      const distorted = pixelToNormalized(
        calibration.markerCenters[name],
        intrinsics,
      );
      const ideal = undistortNormalizedPoint(
        distorted,
        distortion,
      );
      return [
        name,
        [
          intrinsics.fx * ideal[0] +
            intrinsics.skew * ideal[1] +
            intrinsics.cx,
          intrinsics.fy * ideal[1] + intrinsics.cy,
        ],
      ];
    }),
  ) as BodyViewCalibration["markerCenters"];

  return {
    ...calibration,
    markerCenters,
  };
}

function solvePinholeFrames(
  calibrations: BodyViewCalibration[],
) {
  const homographies = calibrations.map(buildHomography);
  const shared = refineSharedIntrinsics(
    calibrations,
    homographies,
  );
  const poses: CameraExtrinsics[] = [];
  const errors: number[] = [];
  let poseIterations = 0;

  for (let index = 0; index < calibrations.length; index += 1) {
    const initial = decomposeHomography(
      homographies[index],
      shared.intrinsics,
    );
    const refined = refinePose(
      calibrations[index],
      shared.intrinsics,
      initial,
    );
    poses.push(refined.pose);
    errors.push(refined.error);
    poseIterations += refined.iterations;
  }

  const rms = Math.sqrt(
    errors.reduce((sum, value) => sum + value * value, 0) /
      Math.max(1, errors.length),
  );

  return {
    intrinsics: shared.intrinsics,
    poses,
    errors,
    rms,
    iterations: shared.iterations + poseIterations,
  };
}

export function scaleOpticalIntrinsics(
  intrinsics: CameraIntrinsics,
  from: { width: number; height: number },
  to: { width: number; height: number },
): CameraIntrinsics {
  const sx = to.width / Math.max(1, from.width);
  const sy = to.height / Math.max(1, from.height);
  return {
    fx: intrinsics.fx * sx,
    fy: intrinsics.fy * sy,
    cx: intrinsics.cx * sx,
    cy: intrinsics.cy * sy,
    skew: intrinsics.skew * sx,
  };
}

export function solveOpticalCalibration(
  calibrations: BodyViewCalibration[],
): OpticalCalibrationProfile {
  if (calibrations.length < 6) {
    throw new Error(
      "A calibração óptica precisa de pelo menos 6 fotos válidas do cartão.",
    );
  }

  const widths = calibrations.map(
    (frame) => frame.imageWidth ?? 0,
  );
  const heights = calibrations.map(
    (frame) => frame.imageHeight ?? 0,
  );
  const imageWidth = widths[0];
  const imageHeight = heights[0];
  if (
    !imageWidth ||
    !imageHeight ||
    widths.some((value) => value !== imageWidth) ||
    heights.some((value) => value !== imageHeight)
  ) {
    throw new Error(
      "Use a mesma orientação e resolução de câmera em todas as fotos ópticas.",
    );
  }

  const firstPass = solvePinholeFrames(calibrations);
  const firstDistortion = fitDistortion(
    calibrations,
    firstPass.poses,
    firstPass.intrinsics,
  );
  const undistorted = calibrations.map((frame) =>
    undistortCalibration(
      frame,
      firstPass.intrinsics,
      firstDistortion,
    ),
  );
  const secondPass = solvePinholeFrames(undistorted);
  const distortion = fitDistortion(
    calibrations,
    secondPass.poses,
    secondPass.intrinsics,
  );

  const distortedErrors = calibrations.map((frame, index) =>
    distortedReprojectionError(
      frame,
      secondPass.intrinsics,
      secondPass.poses[index],
      distortion,
    ),
  );
  const rmsReprojectionErrorPx = Math.sqrt(
    distortedErrors.reduce(
      (sum, value) => sum + value * value,
      0,
    ) / distortedErrors.length,
  );

  const perspective = calibrations.map(
    (frame) => frame.perspectiveSkew,
  );
  const mean =
    perspective.reduce((sum, value) => sum + value, 0) /
    perspective.length;
  const spread =
    Math.max(...perspective) - Math.min(...perspective);
  const conditionScore = clamp(
    mean * 2.7 + spread * 2.4 +
      Math.min(0.3, (calibrations.length - 6) * 0.05),
    0,
    1,
  );
  const warnings: string[] = [];

  if (conditionScore < 0.28) {
    warnings.push(
      "Os ângulos do cartão ficaram parecidos demais. Incline mais o alvo em X/Y e ocupe também as bordas do enquadramento.",
    );
  }
  if (rmsReprojectionErrorPx > 1.8) {
    warnings.push(
      "O erro óptico ainda está alto. Evite desfoque e garanta que os quatro marcadores estejam inteiros.",
    );
  }

  const frames: OpticalCalibrationFrame[] =
    calibrations.map((calibration, index) => ({
      id: `frame-${index + 1}`,
      calibration,
      extrinsics: secondPass.poses[index],
      reprojectionErrorPx: distortedErrors[index],
    }));

  return {
    version: 1,
    method: "multi-frame-brown-conrady-v1",
    intrinsics: secondPass.intrinsics,
    distortion,
    frameCount: calibrations.length,
    imageWidth,
    imageHeight,
    rmsReprojectionErrorPx,
    conditionScore,
    iterations:
      firstPass.iterations + secondPass.iterations,
    frames,
    warnings,
    createdAt: new Date().toISOString(),
  };
}

export async function calibrateOpticsFromPhotos(
  photos: Blob[],
): Promise<OpticalCalibrationProfile> {
  if (photos.length < 6 || photos.length > 12) {
    throw new Error(
      "Selecione entre 6 e 12 fotos ópticas.",
    );
  }

  const frames = await Promise.all(
    photos.map(async (photo, index) => {
      const image = await decodeForCalibration(photo);
      const calibration = detectBodyViewCalibration(image);
      if (!calibration) {
        throw new Error(
          `Foto ${index + 1}: o cartão MIRRO não foi reconhecido inteiro.`,
        );
      }
      return calibration;
    }),
  );

  return solveOpticalCalibration(frames);
}
