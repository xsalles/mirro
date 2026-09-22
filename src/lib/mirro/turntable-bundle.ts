import type { BodyViewId } from "./types";

export type TurntableBundleSample = {
  bodyYcm: number;
  observedHorizontalCm: number;
  observedVerticalCm: number;
  featureHorizontalCm?: number;
  featureConfidence?: number;
};

export type TurntableBundleView = {
  view: BodyViewId;
  nominalAngleRad: number;
  samples: TurntableBundleSample[];
  frameConfidence?: number;
};

export type TurntableBundleSolution = {
  axisOriginCm: [number, number, number];
  axisDirection: [number, number, number];
  axisTiltDeg: number;
  opticalOffsetCm: [number, number];
  angleOffsetsRad: Record<BodyViewId, number>;
  residualCm: number;
  featureResidualCm: number;
  perViewResidualCm: Partial<Record<BodyViewId, number>>;
  acceptedViews: BodyViewId[];
  rejectedViews: BodyViewId[];
  axisVerticalValidation: {
    valid: boolean;
    residualSlopeCmPerCm: number;
  };
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

type ScoreResult = {
  loss: number;
  residualCm: number;
  featureResidualCm: number;
  perViewResidualCm: Partial<Record<BodyViewId, number>>;
  verticalResidualSlopeCmPerCm: number;
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

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
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

function evaluate(
  views: TurntableBundleView[],
  params: Parameters,
): ScoreResult {
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
  let weightedCount = 0;
  let squaredResidual = 0;
  let featureSquaredResidual = 0;
  let featureWeight = 0;
  let verticalCovariance = 0;
  let verticalVariance = 0;
  const perViewResidualCm: Partial<Record<BodyViewId, number>> = {};

  for (const view of views) {
    const angle =
      view.nominalAngleRad +
      (params.angleOffsets[view.view] ?? 0);
    const frameWeight = clamp(
      view.frameConfidence ?? 1,
      0.15,
      1,
    );
    let viewSquared = 0;
    let viewCount = 0;

    for (const sample of view.samples) {
      const rotated = rotateAroundAxis(
        [0, sample.bodyYcm, 0],
        origin,
        direction,
        -angle,
      );
      const predictedX = rotated[0] + params.opticalX;
      const predictedY = rotated[1] - params.opticalY;
      const dx =
        predictedX - sample.observedHorizontalCm;
      const dy =
        predictedY - sample.observedVerticalCm;

      loss +=
        frameWeight * (huber(dx) + huber(dy));
      squaredResidual +=
        frameWeight * (dx * dx + dy * dy);
      weightedCount += frameWeight * 2;
      viewSquared += dx * dx + dy * dy;
      viewCount += 2;

      verticalCovariance +=
        frameWeight * sample.bodyYcm * dy;
      verticalVariance +=
        frameWeight *
        sample.bodyYcm *
        sample.bodyYcm;

      if (
        sample.featureHorizontalCm !== undefined &&
        (sample.featureConfidence ?? 0) > 0
      ) {
        const confidence = clamp(
          sample.featureConfidence ?? 0,
          0,
          1,
        );
        const featureDx =
          predictedX - sample.featureHorizontalCm;
        const weight = frameWeight * confidence * 0.55;
        loss += weight * huber(featureDx, 0.55);
        featureSquaredResidual +=
          weight * featureDx * featureDx;
        featureWeight += weight;
      }
    }

    perViewResidualCm[view.view] =
      Math.sqrt(viewSquared / Math.max(1, viewCount));
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

  return {
    loss: loss / Math.max(1, weightedCount),
    residualCm: Math.sqrt(
      squaredResidual / Math.max(1, weightedCount),
    ),
    featureResidualCm:
      featureWeight > 0
        ? Math.sqrt(featureSquaredResidual / featureWeight)
        : 0,
    perViewResidualCm,
    verticalResidualSlopeCmPerCm:
      verticalVariance > 1e-8
        ? verticalCovariance / verticalVariance
        : 0,
  };
}

function optimize(
  views: TurntableBundleView[],
  initial: Parameters,
  iterations: number,
) {
  let current = cloneParameters(initial);
  let best = evaluate(views, current);

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
        const candidateScore = evaluate(
          views,
          candidate,
        );
        if (candidateScore.loss + 1e-8 < best.loss) {
          current = candidate;
          best = candidateScore;
        }
      }
    }

    const angleStep =
      ((0.9 * Math.PI) / 180) * shrink;
    for (const view of VIEW_ORDER.slice(1)) {
      if (!views.some((item) => item.view === view)) {
        continue;
      }
      for (const direction of [-1, 1]) {
        const candidate = cloneParameters(current);
        candidate.angleOffsets[view] = clamp(
          candidate.angleOffsets[view] +
            angleStep * direction,
          (-5 * Math.PI) / 180,
          (5 * Math.PI) / 180,
        );
        const candidateScore = evaluate(
          views,
          candidate,
        );
        if (candidateScore.loss + 1e-8 < best.loss) {
          current = candidate;
          best = candidateScore;
        }
      }
    }
  }

  return { parameters: current, score: best };
}

function robustAcceptedViews(
  views: TurntableBundleView[],
  residuals: Partial<Record<BodyViewId, number>>,
) {
  const values = views
    .map((view) => residuals[view.view] ?? 0)
    .filter(Number.isFinite);
  const middle = median(values);
  const mad = median(
    values.map((value) => Math.abs(value - middle)),
  );
  const threshold = Math.max(
    1.6,
    middle + Math.max(0.45, mad * 2.75),
  );

  const accepted = views.filter((view) => {
    const residual = residuals[view.view] ?? Infinity;
    const confidence = view.frameConfidence ?? 1;
    return residual <= threshold && confidence >= 0.18;
  });

  return accepted.length >= 6 ? accepted : views;
}

export function solveTurntableBundle(params: {
  views: TurntableBundleView[];
  initialAxisCenterCm?: [number, number];
  maxIterations?: number;
}): TurntableBundleSolution {
  const angleOffsets = Object.fromEntries(
    VIEW_ORDER.map((view) => [view, 0]),
  ) as Record<BodyViewId, number>;

  const initial: Parameters = {
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

  const iterations = params.maxIterations ?? 6;
  const firstPass = optimize(
    params.views,
    initial,
    iterations,
  );
  const acceptedViews = robustAcceptedViews(
    params.views,
    firstPass.score.perViewResidualCm,
  );
  const rejectedViews = params.views
    .filter(
      (view) =>
        !acceptedViews.some(
          (accepted) => accepted.view === view.view,
        ),
    )
    .map((view) => view.view);

  const finalPass =
    rejectedViews.length > 0
      ? optimize(
          acceptedViews,
          firstPass.parameters,
          Math.max(3, Math.ceil(iterations * 0.65)),
        )
      : firstPass;

  const current = finalPass.parameters;
  const finalScore = evaluate(params.views, current);
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
  const verticalSlope =
    finalScore.verticalResidualSlopeCmPerCm;

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
    residualCm: finalScore.residualCm,
    featureResidualCm: finalScore.featureResidualCm,
    perViewResidualCm: finalScore.perViewResidualCm,
    acceptedViews: acceptedViews.map((view) => view.view),
    rejectedViews,
    axisVerticalValidation: {
      valid:
        Number.isFinite(verticalSlope) &&
        Math.abs(verticalSlope) <= 0.035 &&
        tiltDeg <= 5,
      residualSlopeCmPerCm: verticalSlope,
    },
    iterations:
      rejectedViews.length > 0
        ? iterations + Math.max(3, Math.ceil(iterations * 0.65))
        : iterations,
  };
}
