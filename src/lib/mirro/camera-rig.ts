import type {
  BodyCameraRig,
  BodySide,
  BodySilhouette,
  BodyViewCalibration,
  CameraExtrinsics,
  CameraIntrinsics,
} from "./types";

type Point2 = [number, number];
type Vec3 = [number, number, number];
type Mat3 = [
  number, number, number,
  number, number, number,
  number, number, number
];

const SIDES: BodySide[] = ["front", "right", "back", "left"];

const TARGET_POINTS_CM: Record<keyof BodyViewCalibration["markerCenters"], Point2> = {
  magenta: [-7.9, -12.25],
  cyan: [7.9, -12.25],
  yellow: [-7.9, 12.25],
  blue: [7.9, 12.25],
};

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
    if (Math.abs(augmented[pivot][col]) < 1e-10) {
      throw new Error("Sistema de calibração degenerado.");
    }
    [augmented[col], augmented[pivot]] = [augmented[pivot], augmented[col]];

    const scale = augmented[col][col];
    for (let k = col; k <= n; k += 1) augmented[col][k] /= scale;

    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = augmented[row][col];
      if (Math.abs(factor) < 1e-12) continue;
      for (let k = col; k <= n; k += 1) {
        augmented[row][k] -= factor * augmented[col][k];
      }
    }
  }

  return augmented.map((row) => row[n]);
}

export function solvePlanarHomography(
  world: Point2[],
  image: Point2[],
): Mat3 {
  if (world.length !== 4 || image.length !== 4) {
    throw new Error("A homografia MIRRO requer quatro correspondências.");
  }

  const a: number[][] = [];
  const b: number[] = [];

  for (let i = 0; i < 4; i += 1) {
    const [x, y] = world[i];
    const [u, v] = image[i];

    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }

  const h = solveLinearSystem(a, b);
  return [
    h[0], h[1], h[2],
    h[3], h[4], h[5],
    h[6], h[7], 1,
  ];
}

function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a: Vec3, b: Vec3) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function subtractScaled(a: Vec3, b: Vec3, scale: number): Vec3 {
  return [
    a[0] - b[0] * scale,
    a[1] - b[1] * scale,
    a[2] - b[2] * scale,
  ];
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
    h3: [h[2], h[5], h[8]] as Vec3,
  };
}

function rawPoseVectors(h: Mat3, intrinsics: CameraIntrinsics) {
  const { h1, h2, h3 } = homographyColumns(h);
  const q1 = applyKInverse(intrinsics, h1);
  const q2 = applyKInverse(intrinsics, h2);
  const qt = applyKInverse(intrinsics, h3);
  const n1 = Math.hypot(...q1);
  const n2 = Math.hypot(...q2);
  const lambda = 2 / Math.max(1e-8, n1 + n2);
  return {
    r1: q1.map((value) => value * lambda) as Vec3,
    r2: q2.map((value) => value * lambda) as Vec3,
    t: qt.map((value) => value * lambda) as Vec3,
  };
}

export function decomposeHomography(
  homography: Mat3,
  intrinsics: CameraIntrinsics,
): CameraExtrinsics {
  const raw = rawPoseVectors(homography, intrinsics);
  const r1 = normalize(raw.r1);
  const r2Orthogonal = subtractScaled(raw.r2, r1, dot(raw.r2, r1));
  const r2 = normalize(r2Orthogonal);
  const r3 = normalize(cross(r1, r2));

  let t = raw.t;
  if (t[2] < 0) {
    for (let i = 0; i < 3; i += 1) {
      r1[i] *= -1;
      r2[i] *= -1;
      r3[i] *= -1;
    }
    t = [-t[0], -t[1], -t[2]];
  }

  return {
    rotation: [
      r1[0], r2[0], r3[0],
      r1[1], r2[1], r3[1],
      r1[2], r2[2], r3[2],
    ],
    translation: t,
  };
}

function projectPoint(
  point: Point2,
  intrinsics: CameraIntrinsics,
  extrinsics: CameraExtrinsics,
): Point2 {
  const [x, y] = point;
  const r = extrinsics.rotation;
  const t = extrinsics.translation;
  const xc = r[0] * x + r[1] * y + t[0];
  const yc = r[3] * x + r[4] * y + t[1];
  const zc = r[6] * x + r[7] * y + t[2];
  const safeZ = Math.abs(zc) < 1e-8 ? 1e-8 : zc;
  const xn = xc / safeZ;
  const yn = yc / safeZ;
  return [
    intrinsics.fx * xn + intrinsics.skew * yn + intrinsics.cx,
    intrinsics.fy * yn + intrinsics.cy,
  ];
}

function markerPairs(calibration: BodyViewCalibration) {
  const names = ["magenta", "cyan", "yellow", "blue"] as const;
  return names.map((name) => ({
    world: TARGET_POINTS_CM[name],
    image: calibration.markerCenters[name],
  }));
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

function rotatedPose(
  pose: CameraExtrinsics,
  axis: 0 | 1 | 2,
  angle: number,
): CameraExtrinsics {
  return {
    rotation: multiplyMat3(
      deltaRotation(axis, angle),
      pose.rotation as Mat3,
    ),
    translation: [...pose.translation],
  };
}

function reprojectionError(
  calibration: BodyViewCalibration,
  intrinsics: CameraIntrinsics,
  extrinsics: CameraExtrinsics,
) {
  let total = 0;
  let count = 0;
  for (const pair of markerPairs(calibration)) {
    const predicted = projectPoint(pair.world, intrinsics, extrinsics);
    total +=
      (predicted[0] - pair.image[0]) ** 2 +
      (predicted[1] - pair.image[1]) ** 2;
    count += 1;
  }
  return Math.sqrt(total / Math.max(1, count));
}

function refinePose(
  calibration: BodyViewCalibration,
  intrinsics: CameraIntrinsics,
  initial: CameraExtrinsics,
) {
  let pose: CameraExtrinsics = {
    rotation: [...initial.rotation] as CameraExtrinsics["rotation"],
    translation: [...initial.translation],
  };
  let best = reprojectionError(calibration, intrinsics, pose);
  let iterations = 0;
  const distance = Math.max(20, pose.translation[2]);
  const angularSteps = [0.035, 0.015, 0.006, 0.0025, 0.001];
  const translationScales = [0.018, 0.008, 0.0035, 0.0015, 0.0007];

  for (let level = 0; level < angularSteps.length; level += 1) {
    let improved = true;
    let pass = 0;

    while (improved && pass < 8) {
      improved = false;
      pass += 1;

      const candidates: CameraExtrinsics[] = [];
      const angle = angularSteps[level];
      const translationStep = distance * translationScales[level];

      for (const direction of [-1, 1] as const) {
        for (const axis of [0, 1, 2] as const) {
          candidates.push(rotatedPose(pose, axis, angle * direction));
        }

        for (const axis of [0, 1, 2] as const) {
          const translation = [...pose.translation] as [number, number, number];
          translation[axis] += translationStep * direction;
          if (axis === 2) translation[2] = Math.max(5, translation[2]);
          candidates.push({
            rotation: [...pose.rotation] as CameraExtrinsics["rotation"],
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

function orthonormalityResidual(
  homography: Mat3,
  intrinsics: CameraIntrinsics,
) {
  const raw = rawPoseVectors(homography, intrinsics);
  const n1 = Math.hypot(...raw.r1);
  const n2 = Math.hypot(...raw.r2);
  const orthogonal = dot(raw.r1, raw.r2);
  return orthogonal ** 2 + (n1 - n2) ** 2;
}

function calibrationObjective(
  calibrations: Record<BodySide, BodyViewCalibration>,
  homographies: Record<BodySide, Mat3>,
  intrinsics: CameraIntrinsics,
) {
  let reprojection = 0;
  let orthogonality = 0;

  for (const side of SIDES) {
    const pose = decomposeHomography(homographies[side], intrinsics);
    const error = reprojectionError(calibrations[side], intrinsics, pose);
    reprojection += error * error;
    orthogonality += orthonormalityResidual(
      homographies[side],
      intrinsics,
    );
  }

  const width = calibrations.front.imageWidth ?? 1;
  const height = calibrations.front.imageHeight ?? 1;
  const principalPrior =
    ((intrinsics.cx - width / 2) / Math.max(1, width)) ** 2 +
    ((intrinsics.cy - height / 2) / Math.max(1, height)) ** 2;
  const aspectPrior =
    Math.log(Math.max(1e-6, intrinsics.fx / intrinsics.fy)) ** 2;

  return (
    reprojection / SIDES.length +
    orthogonality * 180 +
    principalPrior * 2 +
    aspectPrior * 0.25
  );
}

function refineSharedIntrinsics(
  calibrations: Record<BodySide, BodyViewCalibration>,
  homographies: Record<BodySide, Mat3>,
) {
  const width = calibrations.front.imageWidth ?? 900;
  const height = calibrations.front.imageHeight ?? 900;
  const maxDimension = Math.max(width, height);

  let intrinsics: CameraIntrinsics = {
    fx: maxDimension * 1.15,
    fy: maxDimension * 1.15,
    cx: width / 2,
    cy: height / 2,
    skew: 0,
  };
  let best = calibrationObjective(calibrations, homographies, intrinsics);
  let iterations = 0;

  const scales = [0.22, 0.1, 0.045, 0.02, 0.008];

  for (const scale of scales) {
    let improved = true;
    let localPasses = 0;

    while (improved && localPasses < 8) {
      improved = false;
      localPasses += 1;

      const candidates: CameraIntrinsics[] = [];
      const focalStep = maxDimension * scale;
      const centerStep = maxDimension * scale * 0.28;
      const aspectStep = maxDimension * scale * 0.35;

      for (const direction of [-1, 1]) {
        candidates.push({
          ...intrinsics,
          fx: clamp(
            intrinsics.fx + focalStep * direction,
            maxDimension * 0.35,
            maxDimension * 4,
          ),
        });
        candidates.push({
          ...intrinsics,
          fy: clamp(
            intrinsics.fy + aspectStep * direction,
            maxDimension * 0.35,
            maxDimension * 4,
          ),
        });
        candidates.push({
          ...intrinsics,
          cx: clamp(intrinsics.cx + centerStep * direction, 0, width),
        });
        candidates.push({
          ...intrinsics,
          cy: clamp(intrinsics.cy + centerStep * direction, 0, height),
        });
      }

      for (const candidate of candidates) {
        iterations += 1;
        const score = calibrationObjective(
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


function invertMat3(matrix: Mat3): Mat3 {
  const [
    a, b, c,
    d, e, f,
    g, h, i,
  ] = matrix;
  const aa = e * i - f * h;
  const bb = -(d * i - f * g);
  const cc = d * h - e * g;
  const det = a * aa + b * bb + c * cc;

  if (Math.abs(det) < 1e-12) {
    throw new Error("Homografia sem inversa estável.");
  }

  const inv = 1 / det;
  return [
    aa * inv,
    -(b * i - c * h) * inv,
    (b * f - c * e) * inv,
    bb * inv,
    (a * i - c * g) * inv,
    -(a * f - c * d) * inv,
    cc * inv,
    -(a * h - b * g) * inv,
    (a * e - b * d) * inv,
  ];
}

function transformHomogeneous(matrix: Mat3, point: Point2): Point2 {
  const [x, y] = point;
  const w = matrix[6] * x + matrix[7] * y + matrix[8];
  const safeW = Math.abs(w) < 1e-10 ? 1e-10 : w;
  return [
    (matrix[0] * x + matrix[1] * y + matrix[2]) / safeW,
    (matrix[3] * x + matrix[4] * y + matrix[5]) / safeW,
  ];
}

export function rectifySilhouetteWithPinhole(
  silhouette: BodySilhouette,
  calibration: BodyViewCalibration,
): BodySilhouette {
  if (!calibration.homography) return silhouette;

  let inverse: Mat3;
  try {
    inverse = invertMat3(calibration.homography);
  } catch {
    return silhouette;
  }

  const centerX = silhouette.bounds.x + silhouette.bounds.width / 2;
  const fallback = silhouette.metricWidthProfileCm;
  const metricWidthProfileCm = silhouette.widthProfile.map(
    (normalizedWidth, index) => {
      const t =
        silhouette.widthProfile.length <= 1
          ? 0
          : index / (silhouette.widthProfile.length - 1);
      const y =
        silhouette.bounds.y +
        t * Math.max(1, silhouette.bounds.height - 1);
      const widthPx = normalizedWidth * silhouette.bounds.height;
      const left = transformHomogeneous(inverse, [
        centerX - widthPx / 2,
        y,
      ]);
      const right = transformHomogeneous(inverse, [
        centerX + widthPx / 2,
        y,
      ]);
      const observed = Math.hypot(
        right[0] - left[0],
        right[1] - left[1],
      );

      const previous = fallback?.[index];
      if (!Number.isFinite(observed) || observed <= 0) {
        return previous ?? normalizedWidth * (silhouette.metricBodyHeightCm ?? 170);
      }
      if (previous && Number.isFinite(previous)) {
        return clamp(observed, previous * 0.65, previous * 1.45);
      }
      return observed;
    },
  );

  const top = transformHomogeneous(inverse, [
    centerX,
    silhouette.bounds.y,
  ]);
  const bottom = transformHomogeneous(inverse, [
    centerX,
    silhouette.bounds.y + silhouette.bounds.height - 1,
  ]);
  const observedHeight = Math.hypot(
    bottom[0] - top[0],
    bottom[1] - top[1],
  );
  const previousHeight = silhouette.metricBodyHeightCm;
  const metricBodyHeightCm =
    previousHeight && Number.isFinite(previousHeight)
      ? clamp(observedHeight, previousHeight * 0.7, previousHeight * 1.35)
      : observedHeight;

  return {
    ...silhouette,
    metricWidthProfileCm,
    metricBodyHeightCm,
    viewCalibration: calibration,
  };
}

export function solveBodyCameraRig(
  calibrations: Record<BodySide, BodyViewCalibration>,
): {
  rig: BodyCameraRig;
  calibrations: Record<BodySide, BodyViewCalibration>;
} {
  const homographies = {} as Record<BodySide, Mat3>;

  for (const side of SIDES) {
    const calibration = calibrations[side];
    if (!calibration.imageWidth || !calibration.imageHeight) {
      throw new Error("As quatro vistas precisam registrar o tamanho da imagem.");
    }
    const pairs = markerPairs(calibration);
    homographies[side] = solvePlanarHomography(
      pairs.map((pair) => pair.world),
      pairs.map((pair) => pair.image),
    );
  }

  const { intrinsics, iterations } = refineSharedIntrinsics(
    calibrations,
    homographies,
  );

  const views = {} as BodyCameraRig["views"];
  const updated = {} as Record<BodySide, BodyViewCalibration>;
  let squaredError = 0;
  let poseIterations = 0;

  for (const side of SIDES) {
    const initialExtrinsics = decomposeHomography(
      homographies[side],
      intrinsics,
    );
    const refined = refinePose(
      calibrations[side],
      intrinsics,
      initialExtrinsics,
    );
    const extrinsics = refined.pose;
    const error = refined.error;
    poseIterations += refined.iterations;
    squaredError += error * error;
    views[side] = {
      ...extrinsics,
      homography: homographies[side],
      reprojectionErrorPx: error,
    };
    updated[side] = {
      ...calibrations[side],
      method: "mirro-a4-pinhole-v2",
      homography: homographies[side],
      extrinsics,
      reprojectionErrorPx: error,
    };
  }

  const rmsReprojectionErrorPx = Math.sqrt(
    squaredError / SIDES.length,
  );
  const perspectiveValues = SIDES.map(
    (side) => calibrations[side].perspectiveSkew,
  );
  const perspectiveMean =
    perspectiveValues.reduce((sum, value) => sum + value, 0) /
    perspectiveValues.length;
  const perspectiveSpread =
    Math.max(...perspectiveValues) - Math.min(...perspectiveValues);
  const conditionScore = clamp(
    perspectiveMean * 3.2 + perspectiveSpread * 2.1,
    0,
    1,
  );
  const warnings: string[] = [];

  if (conditionScore < 0.16) {
    warnings.push(
      "As vistas do alvo estão quase frontais; os intrínsecos ficam pouco condicionados. Incline levemente o cartão entre capturas para uma solução óptica mais forte.",
    );
  }
  if (rmsReprojectionErrorPx > 2.2) {
    warnings.push(
      "O erro de reprojeção do alvo está alto; refaça as fotos sem desfoque e com os quatro marcadores inteiros.",
    );
  }

  return {
    rig: {
      version: 1,
      method: "shared-pinhole-bundle-v1",
      intrinsics,
      views,
      rmsReprojectionErrorPx,
      iterations: iterations + poseIterations,
      conditionScore,
      warnings,
    },
    calibrations: updated,
  };
}
