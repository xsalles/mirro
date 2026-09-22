import type { BodyViewId } from "./types";

export type TurntableBundleSample = {
  bodyYcm: number;
  observedHorizontalCm: number;
  observedVerticalCm: number;
};

export type TurntableBundleView = {
  view: BodyViewId;
  nominalAngleRad: number;
  samples: TurntableBundleSample[];
};

export type TurntableBundleSolution = {
  axisOriginCm: [number, number, number];
  axisDirection: [number, number, number];
  axisTiltDeg: number;
  opticalOffsetCm: [number, number];
  angleOffsetsRad: Record<BodyViewId, number>;
  residualCm: number;
  iterations: number;
};

type Parameters = {
  axisX: number;
  axisZ: number;
  tiltX: number;
  tiltZ: number;
  opticalX: number;
  opticalY: number;
  angleOffsets: Record<BodyViewId, number>;
};

const VIEW_ORDER: BodyViewId[] = [
  "front",
  "frontRight",
  "right",
  "backRight",
  "back",
  "backLeft",
  "left",
  "frontLeft",
];

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalize(
  vector: [number, number, number],
): [number, number, number] {
  const length = Math.hypot(
    vector[0],
    vector[1],
    vector[2],
  ) || 1;
  return [
    vector[0] / length,
    vector[1] / length,
    vector[2] / length,
  ];
}

export function rotateAroundAxis(
  point: [number, number, number],
  origin: [number, number, number],
  direction: [number, number, number],
  angleRad: number,
): [number, number, number] {
  const axis = normalize(direction);
  const x = point[0] - origin[0];
  const y = point[1] - origin[1];
  const z = point[2] - origin[2];
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const dot =
    axis[0] * x +
    axis[1] * y +
    axis[2] * z;
  const crossX = axis[1] * z - axis[2] * y;
  const crossY = axis[2] * x - axis[0] * z;
  const crossZ = axis[0] * y - axis[1] * x;

  return [
    origin[0] +
      x * cos +
      crossX * sin +
      axis[0] * dot * (1 - cos),
    origin[1] +
      y * cos +
      crossY * sin +
      axis[1] * dot * (1 - cos),
    origin[2] +
      z * cos +
      crossZ * sin +
      axis[2] * dot * (1 - cos),
  ];
}

function huber(value: number, delta = 0.75) {
  const absolute = Math.abs(value);
  return absolute <= delta
    ? 0.5 * value * value
    : delta * (absolute - 0.5 * delta);
}

function cloneParameters(source: Parameters): Parameters {
  return {
    ...source,
    angleOffsets: { ...source.angleOffsets },
  };
}

function score(
  views: TurntableBundleView[],
  params: Parameters,
) {
  const direction = normalize([
    params.tiltX,
    1,
    params.tiltZ,
  ]);
  const origin: [number, number, number] = [
    params.axisX,
    0,
    params.axisZ,
  ];

  let loss = 0;
  let count = 0;

  for (const view of views) {
    const angle =
      view.nominalAngleRad +
      (params.angleOffsets[view.view] ?? 0);

    for (const sample of view.samples) {
      const rotated = rotateAroundAxis(
        [0, sample.bodyYcm, 0],
        origin,
        direction,
        -angle,
      );
      const dx =
        rotated[0] +
        params.opticalX -
        sample.observedHorizontalCm;
      const dy =
        rotated[1] -
        params.opticalY -
        sample.observedVerticalCm;

      loss += huber(dx) + huber(dy);
      count += 2;
    }
  }

  const angleSigma =
    (2.2 * Math.PI) / 180;
  for (const view of VIEW_ORDER.slice(1)) {
    const offset = params.angleOffsets[view] ?? 0;
    loss +=
      0.08 *
      (offset / angleSigma) *
      (offset / angleSigma);
  }

  const tiltSigma = Math.tan(
    (2.5 * Math.PI) / 180,
  );
  loss +=
    0.08 *
    ((params.tiltX / tiltSigma) ** 2 +
      (params.tiltZ / tiltSigma) ** 2);

  return loss / Math.max(1, count);
}

export function solveTurntableBundle(params: {
  views: TurntableBundleView[];
  initialAxisCenterCm?: [number, number];
  maxIterations?: number;
}): TurntableBundleSolution {
  const angleOffsets = Object.fromEntries(
    VIEW_ORDER.map((view) => [view, 0]),
  ) as Record<BodyViewId, number>;

  let current: Parameters = {
    axisX: clamp(
      params.initialAxisCenterCm?.[0] ?? 0,
      -8,
      8,
    ),
    axisZ: clamp(
      params.initialAxisCenterCm?.[1] ?? 0,
      -8,
      8,
    ),
    tiltX: 0,
    tiltZ: 0,
    opticalX: 0,
    opticalY: 0,
    angleOffsets,
  };

  let bestScore = score(params.views, current);
  const iterations = params.maxIterations ?? 6;

  for (
    let iteration = 0;
    iteration < iterations;
    iteration += 1
  ) {
    const shrink = 0.58 ** iteration;
    const scalarMoves: Array<{
      key:
        | "axisX"
        | "axisZ"
        | "tiltX"
        | "tiltZ"
        | "opticalX"
        | "opticalY";
      step: number;
      min: number;
      max: number;
    }> = [
      { key: "axisX", step: 0.9 * shrink, min: -8, max: 8 },
      { key: "axisZ", step: 0.9 * shrink, min: -8, max: 8 },
      {
        key: "tiltX",
        step:
          Math.tan((0.7 * Math.PI) / 180) * shrink,
        min: -Math.tan((5 * Math.PI) / 180),
        max: Math.tan((5 * Math.PI) / 180),
      },
      {
        key: "tiltZ",
        step:
          Math.tan((0.7 * Math.PI) / 180) * shrink,
        min: -Math.tan((5 * Math.PI) / 180),
        max: Math.tan((5 * Math.PI) / 180),
      },
      {
        key: "opticalX",
        step: 0.65 * shrink,
        min: -12,
        max: 12,
      },
      {
        key: "opticalY",
        step: 0.65 * shrink,
        min: -12,
        max: 12,
      },
    ];

    for (const move of scalarMoves) {
      for (const direction of [-1, 1]) {
        const candidate = cloneParameters(current);
        candidate[move.key] = clamp(
          candidate[move.key] +
            move.step * direction,
          move.min,
          move.max,
        );
        const candidateScore = score(
          params.views,
          candidate,
        );
        if (candidateScore + 1e-8 < bestScore) {
          current = candidate;
          bestScore = candidateScore;
        }
      }
    }

    const angleStep =
      ((0.9 * Math.PI) / 180) * shrink;
    for (const view of VIEW_ORDER.slice(1)) {
      for (const direction of [-1, 1]) {
        const candidate = cloneParameters(current);
        candidate.angleOffsets[view] = clamp(
          candidate.angleOffsets[view] +
            angleStep * direction,
          (-5 * Math.PI) / 180,
          (5 * Math.PI) / 180,
        );
        const candidateScore = score(
          params.views,
          candidate,
        );
        if (candidateScore + 1e-8 < bestScore) {
          current = candidate;
          bestScore = candidateScore;
        }
      }
    }
  }

  const direction = normalize([
    current.tiltX,
    1,
    current.tiltZ,
  ]);
  const tiltDeg =
    (Math.acos(
      clamp(direction[1], -1, 1),
    ) *
      180) /
    Math.PI;

  return {
    axisOriginCm: [
      current.axisX,
      0,
      current.axisZ,
    ],
    axisDirection: direction,
    axisTiltDeg: tiltDeg,
    opticalOffsetCm: [
      current.opticalX,
      current.opticalY,
    ],
    angleOffsetsRad: current.angleOffsets,
    residualCm: Math.sqrt(
      Math.max(0, bestScore * 2),
    ),
    iterations,
  };
}
