import type { RgbaImage } from "./body-calibration";
import {
  BODY_VIEW_ANGLE_RAD,
  BODY_VIEW_SEQUENCE,
} from "./body-views";
import { sampleSignedDistance } from "./signed-distance-field";
import { scaleOpticalIntrinsics } from "./optical-calibration";
import {
  censusHamming32,
  getCensusPopcountKernel,
} from "./mvs-wasm-kernel";
import {
  getMvsNumericBackend,
  patchStatistics,
  weightedMean,
} from "./mvs-simd-kernel";
import {
  rotateAroundAxis,
  solveTurntableBundle,
  type TurntableBundleView,
} from "./turntable-bundle";
import type {
  BodyDepthMap,
  BodyMultiViewStereo,
  CameraIntrinsics,
  BodySilhouette,
  BodyTsdfVolume,
  BodyViewId,
  BodyVisualHull,
  OpticalCalibrationProfile,
} from "./types";

type Vec3 = [number, number, number];

type TurntableCamera = {
  intrinsics: CameraIntrinsics;
  distanceCm: number;
  horizontalOffsetCm: number;
  verticalOffsetCm: number;
};

type TurntablePose = {
  angleRad: number;
  axisOriginCm: [number, number, number];
  axisDirection: [number, number, number];
};

type FeatureLevel = {
  scale: number;
  width: number;
  height: number;
  luminance: Float32Array;
  gradient: Float32Array;
};

type MvsView = {
  image: RgbaImage;
  mask: Uint8Array;
  silhouette: BodySilhouette;
  luminance: Float32Array;
  gradient: Float32Array;
  pyramid: FeatureLevel[];
  camera?: TurntableCamera;
  pose?: TurntablePose;
  bundleAccepted?: boolean;
};

const INVALID_DEPTH = -32768;
const DEPTH_QUANTIZATION_CM = 0.05;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function sampleProfile(values: number[] | undefined, t: number) {
  if (!values?.length) return 0;
  const position = clamp(t, 0, 1) * (values.length - 1);
  const low = Math.floor(position);
  const high = Math.min(values.length - 1, low + 1);
  const mix = position - low;
  return (
    (values[low] ?? 0) +
    ((values[high] ?? values[low] ?? 0) -
      (values[low] ?? 0)) *
      mix
  );
}

function buildLuminance(image: RgbaImage) {
  const output = new Float32Array(image.width * image.height);
  for (let pixel = 0; pixel < output.length; pixel += 1) {
    const offset = pixel * 4;
    output[pixel] =
      image.data[offset] * 0.2126 +
      image.data[offset + 1] * 0.7152 +
      image.data[offset + 2] * 0.0722;
  }
  return output;
}

function buildGradientMagnitude(
  luminance: Float32Array,
  width: number,
  height: number,
) {
  const output = new Float32Array(width * height);

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const gx =
        (luminance[y * width + x + 1] -
          luminance[y * width + x - 1]) *
        0.5;
      const gy =
        (luminance[(y + 1) * width + x] -
          luminance[(y - 1) * width + x]) *
        0.5;
      output[y * width + x] = Math.hypot(gx, gy);
    }
  }

  return output;
}

function downsampleFloat(
  input: Float32Array,
  width: number,
  height: number,
) {
  const nextWidth = Math.max(1, Math.floor(width / 2));
  const nextHeight = Math.max(1, Math.floor(height / 2));
  const output = new Float32Array(
    nextWidth * nextHeight,
  );

  for (let y = 0; y < nextHeight; y += 1) {
    for (let x = 0; x < nextWidth; x += 1) {
      const sx = x * 2;
      const sy = y * 2;
      let sum = 0;
      let count = 0;

      for (let dy = 0; dy < 2; dy += 1) {
        for (let dx = 0; dx < 2; dx += 1) {
          const px = sx + dx;
          const py = sy + dy;
          if (px >= width || py >= height) continue;
          sum += input[py * width + px];
          count += 1;
        }
      }

      output[y * nextWidth + x] =
        count > 0 ? sum / count : 0;
    }
  }

  return {
    values: output,
    width: nextWidth,
    height: nextHeight,
  };
}

function buildFeaturePyramid(
  luminance: Float32Array,
  width: number,
  height: number,
): FeatureLevel[] {
  const levels: FeatureLevel[] = [];
  let current = luminance;
  let currentWidth = width;
  let currentHeight = height;
  let scale = 1;

  for (let level = 0; level < 3; level += 1) {
    levels.push({
      scale,
      width: currentWidth,
      height: currentHeight,
      luminance: current,
      gradient: buildGradientMagnitude(
        current,
        currentWidth,
        currentHeight,
      ),
    });

    if (
      level === 2 ||
      currentWidth < 48 ||
      currentHeight < 48
    ) {
      break;
    }

    const next = downsampleFloat(
      current,
      currentWidth,
      currentHeight,
    );
    current = next.values;
    currentWidth = next.width;
    currentHeight = next.height;
    scale *= 0.5;
  }

  return levels;
}

function median(values: number[]) {
  if (!values.length) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2
    ? ordered[middle]
    : (ordered[middle - 1] + ordered[middle]) / 2;
}

function calibratedCameraForView(params: {
  image: RgbaImage;
  silhouette: BodySilhouette;
  bodyHeightCm: number;
  frontDepthCm: number;
  optics?: OpticalCalibrationProfile;
}): TurntableCamera | undefined {
  const optics = params.optics;
  if (!optics) return undefined;

  const imageAspect =
    params.image.width / Math.max(1, params.image.height);
  const opticsAspect =
    optics.imageWidth / Math.max(1, optics.imageHeight);
  if (
    Math.abs(
      imageAspect / Math.max(1e-6, opticsAspect) - 1,
    ) > 0.025
  ) {
    return undefined;
  }

  const intrinsics = scaleOpticalIntrinsics(
    optics.intrinsics,
    {
      width: optics.imageWidth,
      height: optics.imageHeight,
    },
    {
      width: params.image.width,
      height: params.image.height,
    },
  );

  const distanceCm = Math.max(
    params.bodyHeightCm * 1.05,
    (intrinsics.fy * params.bodyHeightCm) /
        Math.max(1, params.silhouette.bounds.height) +
      Math.max(0, params.frontDepthCm),
  );
  const referenceCameraDepth = Math.max(
    1,
    distanceCm - Math.max(0, params.frontDepthCm),
  );
  const centerProfile =
    sampleProfile(
      params.silhouette.centerProfile,
      0.5,
    ) * params.silhouette.bounds.height;
  const bodyCenterX =
    params.silhouette.bounds.x +
    params.silhouette.bounds.width / 2 +
    centerProfile;
  const bodyCenterY =
    params.silhouette.bounds.y +
    params.silhouette.bounds.height / 2;

  return {
    intrinsics,
    distanceCm,
    horizontalOffsetCm:
      ((intrinsics.cx - bodyCenterX) *
        referenceCameraDepth) /
      Math.max(1e-6, intrinsics.fx),
    verticalOffsetCm:
      ((bodyCenterY - intrinsics.cy) *
        referenceCameraDepth) /
      Math.max(1e-6, intrinsics.fy),
  };
}

type OptimizedTurntableRig = {
  cameras: Record<BodyViewId, TurntableCamera>;
  poses?: Record<BodyViewId, TurntablePose>;
  metadata: NonNullable<
    BodyMultiViewStereo["turntableRig"]
  >;
};

function optimizeTurntableCameras(
  candidates: Record<
    BodyViewId,
    TurntableCamera | undefined
  >,
): OptimizedTurntableRig | undefined {
  if (
    !BODY_VIEW_SEQUENCE.every((view) =>
      Boolean(candidates[view]),
    )
  ) {
    return undefined;
  }

  const resolved = candidates as Record<
    BodyViewId,
    TurntableCamera
  >;
  const sharedDistanceCm = median(
    BODY_VIEW_SEQUENCE.map(
      (view) => resolved[view].distanceCm,
    ),
  );
  const verticalOpticalOffsetCm = median(
    BODY_VIEW_SEQUENCE.map(
      (view) => resolved[view].verticalOffsetCm,
    ),
  );

  let suu = 0;
  let suv = 0;
  let svv = 0;
  let suh = 0;
  let svh = 0;

  for (const view of BODY_VIEW_SEQUENCE) {
    const angle = BODY_VIEW_ANGLE_RAD[view];
    const u = Math.cos(angle);
    const v = -Math.sin(angle);
    const h = resolved[view].horizontalOffsetCm;
    suu += u * u;
    suv += u * v;
    svv += v * v;
    suh += u * h;
    svh += v * h;
  }

  const determinant = suu * svv - suv * suv;
  let axisX = 0;
  let axisZ = 0;

  if (Math.abs(determinant) > 1e-7) {
    axisX = (suh * svv - svh * suv) / determinant;
    axisZ = (svh * suu - suh * suv) / determinant;
  }

  axisX = clamp(axisX, -8, 8);
  axisZ = clamp(axisZ, -8, 8);

  let squaredResidual = 0;
  const cameras = Object.fromEntries(
    BODY_VIEW_SEQUENCE.map((view) => {
      const angle = BODY_VIEW_ANGLE_RAD[view];
      const predictedHorizontal =
        axisX * Math.cos(angle) -
        axisZ * Math.sin(angle);
      const residual =
        resolved[view].horizontalOffsetCm -
        predictedHorizontal;
      squaredResidual += residual * residual;

      return [
        view,
        {
          ...resolved[view],
          distanceCm: sharedDistanceCm,
          horizontalOffsetCm: predictedHorizontal,
          verticalOffsetCm: verticalOpticalOffsetCm,
        },
      ];
    }),
  ) as Record<BodyViewId, TurntableCamera>;

  return {
    cameras,
    metadata: {
      version: 1,
      method: "shared-axis-center-least-squares-v1",
      optimized: true,
      axisCenterCm: [axisX, 0, axisZ],
      sharedCameraDistanceCm: sharedDistanceCm,
      verticalOpticalOffsetCm,
      centerResidualCm: Math.sqrt(
        squaredResidual / BODY_VIEW_SEQUENCE.length,
      ),
    },
  };
}

function imageFeatureAxisAnchor(params: {
  gradient: Float32Array;
  mask: Uint8Array;
  width: number;
  height: number;
  rowCenterX: number;
  rowWidthPx: number;
  pixelY: number;
}) {
  const y = clamp(
    Math.round(params.pixelY),
    1,
    params.height - 2,
  );
  const half = Math.max(3, params.rowWidthPx / 2);
  const leftStart = clamp(
    Math.floor(params.rowCenterX - half),
    1,
    params.width - 2,
  );
  const leftEnd = clamp(
    Math.floor(params.rowCenterX - half * 0.18),
    leftStart,
    params.width - 2,
  );
  const rightStart = clamp(
    Math.ceil(params.rowCenterX + half * 0.18),
    1,
    params.width - 2,
  );
  const rightEnd = clamp(
    Math.ceil(params.rowCenterX + half),
    rightStart,
    params.width - 2,
  );

  const strongest = (start: number, end: number) => {
    let bestX = -1;
    let best = 0;
    for (let x = start; x <= end; x += 1) {
      const index = y * params.width + x;
      if (!params.mask[index]) continue;
      const value = params.gradient[index] ?? 0;
      if (value > best) {
        best = value;
        bestX = x;
      }
    }
    return { x: bestX, strength: best };
  };

  const left = strongest(leftStart, leftEnd);
  const right = strongest(rightStart, rightEnd);
  if (left.x < 0 || right.x < 0) return null;

  const confidence = clamp(
    Math.min(left.strength, right.strength) / 52,
    0,
    1,
  );
  if (confidence < 0.08) return null;

  return {
    x: (left.x + right.x) / 2,
    confidence,
  };
}

function optimizeTurntableBundleFromSilhouettes(params: {
  candidates: Record<
    BodyViewId,
    TurntableCamera | undefined
  >;
  silhouettes: Record<BodyViewId, BodySilhouette>;
  images: Record<BodyViewId, RgbaImage>;
  masks: Record<BodyViewId, Uint8Array>;
  bodyHeightCm: number;
}): OptimizedTurntableRig | undefined {
  const initial = optimizeTurntableCameras(
    params.candidates,
  );
  if (!initial) return undefined;

  const resolved = params.candidates as Record<
    BodyViewId,
    TurntableCamera
  >;
  const sharedDistanceCm =
    initial.metadata.sharedCameraDistanceCm ??
    median(
      BODY_VIEW_SEQUENCE.map(
        (view) => resolved[view].distanceCm,
      ),
    );

  const featureFields = Object.fromEntries(
    BODY_VIEW_SEQUENCE.map((view) => {
      const image = params.images[view];
      const luminance = buildLuminance(image);
      return [
        view,
        buildGradientMagnitude(
          luminance,
          image.width,
          image.height,
        ),
      ];
    }),
  ) as Record<BodyViewId, Float32Array>;

  const bundleViews: TurntableBundleView[] =
    BODY_VIEW_SEQUENCE.map((view) => {
      const camera = resolved[view];
      const silhouette = params.silhouettes[view];
      const image = params.images[view];
      const featureConfidences: number[] = [];
      const samples = [
        0.18, 0.3, 0.42, 0.5, 0.58, 0.7, 0.82,
      ].map((vertical) => {
        const row = rowGeometry(
          silhouette,
          params.bodyHeightCm,
          vertical,
        );
        const pixelY =
          silhouette.bounds.y +
          vertical *
            Math.max(
              1,
              silhouette.bounds.height - 1,
            );
        const feature = imageFeatureAxisAnchor({
          gradient: featureFields[view],
          mask: params.masks[view],
          width: image.width,
          height: image.height,
          rowCenterX: row.centerX,
          rowWidthPx: row.rowWidthPx,
          pixelY,
        });
        if (feature) {
          featureConfidences.push(feature.confidence);
        }

        return {
          bodyYcm:
            params.bodyHeightCm / 2 -
            vertical * params.bodyHeightCm,
          observedHorizontalCm:
            ((row.centerX -
              camera.intrinsics.cx) *
              sharedDistanceCm) /
            Math.max(
              1e-6,
              camera.intrinsics.fx,
            ),
          observedVerticalCm:
            (-(pixelY -
              camera.intrinsics.cy) *
              sharedDistanceCm) /
            Math.max(
              1e-6,
              camera.intrinsics.fy,
            ),
          featureHorizontalCm: feature
            ? ((feature.x -
                camera.intrinsics.cx) *
                sharedDistanceCm) /
              Math.max(
                1e-6,
                camera.intrinsics.fx,
              )
            : undefined,
          featureConfidence:
            feature?.confidence,
        };
      });

      const featureConfidence =
        featureConfidences.length > 0
          ? featureConfidences.reduce(
              (sum, value) => sum + value,
              0,
            ) / featureConfidences.length
          : 0;

      return {
        view,
        nominalAngleRad:
          BODY_VIEW_ANGLE_RAD[view],
        samples,
        frameConfidence: clamp(
          silhouette.confidence *
            (0.55 + featureConfidence * 0.45),
          0,
          1,
        ),
      };
    });

  const solved = solveTurntableBundle({
    views: bundleViews,
    initialAxisCenterCm: [
      initial.metadata.axisCenterCm[0],
      initial.metadata.axisCenterCm[2],
    ],
    maxIterations: 7,
  });

  const cameras = Object.fromEntries(
    BODY_VIEW_SEQUENCE.map((view) => [
      view,
      {
        ...resolved[view],
        distanceCm: sharedDistanceCm,
        horizontalOffsetCm:
          solved.opticalOffsetCm[0],
        verticalOffsetCm:
          solved.opticalOffsetCm[1],
      },
    ]),
  ) as Record<BodyViewId, TurntableCamera>;

  const poses = Object.fromEntries(
    BODY_VIEW_SEQUENCE.map((view) => [
      view,
      {
        angleRad:
          BODY_VIEW_ANGLE_RAD[view] +
          solved.angleOffsetsRad[view],
        axisOriginCm: solved.axisOriginCm,
        axisDirection: solved.axisDirection,
      },
    ]),
  ) as Record<BodyViewId, TurntablePose>;

  return {
    cameras,
    poses,
    metadata: {
      version: 3,
      method: "feature-residual-frame-rejection-bundle-v3",
      optimized: true,
      axisCenterCm: solved.axisOriginCm,
      sharedCameraDistanceCm: sharedDistanceCm,
      verticalOpticalOffsetCm:
        solved.opticalOffsetCm[1],
      centerResidualCm:
        initial.metadata.centerResidualCm,
      axisDirection: solved.axisDirection,
      axisTiltDeg: solved.axisTiltDeg,
      perViewAngleOffsetDeg:
        Object.fromEntries(
          BODY_VIEW_SEQUENCE.map((view) => [
            view,
            (solved.angleOffsetsRad[view] *
              180) /
              Math.PI,
          ]),
        ),
      bundleResidualCm: solved.residualCm,
      bundleIterations: solved.iterations,
      featureResidualCm: solved.featureResidualCm,
      rejectedViews: solved.rejectedViews,
      acceptedViews: solved.acceptedViews,
      axisVerticalValidated:
        solved.axisVerticalValidation.valid,
      axisVerticalResidualSlopeCmPerCm:
        solved.axisVerticalValidation
          .residualSlopeCmPerCm,
    },
  };
}

function rowGeometry(
  silhouette: BodySilhouette,
  bodyHeightCm: number,
  vertical: number,
) {
  const t = clamp(vertical, 0, 1);
  const rowWidthPx = Math.max(
    1,
    sampleProfile(silhouette.widthProfile, t) *
      silhouette.bounds.height,
  );
  const metricSpanCm = Math.max(
    1,
    sampleProfile(silhouette.metricWidthProfileCm, t) ||
      sampleProfile(silhouette.widthProfile, t) *
        bodyHeightCm,
  );
  const centerOffsetPx =
    sampleProfile(silhouette.centerProfile, t) *
    silhouette.bounds.height;
  const centerX =
    silhouette.bounds.x +
    silhouette.bounds.width / 2 +
    centerOffsetPx;

  return { rowWidthPx, metricSpanCm, centerX };
}

function pixelToViewCoordinates(
  view: MvsView,
  bodyHeightCm: number,
  pixelX: number,
  pixelY: number,
  depthCm: number,
) {
  if (view.camera) {
    const { intrinsics, distanceCm } = view.camera;
    const cameraDepth = Math.max(
      1,
      distanceCm - depthCm,
    );
    return {
      horizontalCm:
        view.camera.horizontalOffsetCm +
        ((pixelX - intrinsics.cx) * cameraDepth) /
          Math.max(1e-6, intrinsics.fx),
      y:
        view.camera.verticalOffsetCm -
        ((pixelY - intrinsics.cy) * cameraDepth) /
          Math.max(1e-6, intrinsics.fy),
      vertical: clamp(
        (pixelY - view.silhouette.bounds.y) /
          Math.max(1, view.silhouette.bounds.height - 1),
        0,
        1,
      ),
    };
  }

  const silhouette = view.silhouette;
  const vertical = clamp(
    (pixelY - silhouette.bounds.y) /
      Math.max(1, silhouette.bounds.height - 1),
    0,
    1,
  );
  const row = rowGeometry(
    silhouette,
    bodyHeightCm,
    vertical,
  );
  const horizontalCm =
    ((pixelX - row.centerX) / row.rowWidthPx) *
    row.metricSpanCm;
  const y =
    bodyHeightCm / 2 - vertical * bodyHeightCm;
  return {
    horizontalCm,
    y,
    vertical,
  };
}

function nominalBodyToView(
  view: BodyViewId,
  point: Vec3,
): Vec3 {
  const angle = BODY_VIEW_ANGLE_RAD[view];
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [
    point[0] * cos - point[2] * sin,
    point[1],
    point[0] * sin + point[2] * cos,
  ];
}

function bodyToViewPoint(
  view: BodyViewId,
  point: Vec3,
  pose?: TurntablePose,
): Vec3 {
  if (!pose) {
    return nominalBodyToView(view, point);
  }

  return rotateAroundAxis(
    point,
    pose.axisOriginCm,
    pose.axisDirection,
    -pose.angleRad,
  );
}

function viewCoordinatesToWorld(
  view: BodyViewId,
  horizontalCm: number,
  y: number,
  depthCm: number,
  pose?: TurntablePose,
): Vec3 {
  if (!pose) {
    const angle = BODY_VIEW_ANGLE_RAD[view];
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return [
      horizontalCm * cos + depthCm * sin,
      y,
      -horizontalCm * sin + depthCm * cos,
    ];
  }

  return rotateAroundAxis(
    [horizontalCm, y, depthCm],
    pose.axisOriginCm,
    pose.axisDirection,
    pose.angleRad,
  );
}

function nominalWorldDepth(
  view: BodyViewId,
  x: number,
  z: number,
) {
  const angle = BODY_VIEW_ANGLE_RAD[view];
  return (
    x * Math.sin(angle) +
    z * Math.cos(angle)
  );
}

function worldToPixel(
  viewId: BodyViewId,
  view: MvsView,
  bodyHeightCm: number,
  x: number,
  y: number,
  z: number,
) {
  const viewPoint = bodyToViewPoint(
    viewId,
    [x, y, z],
    view.pose,
  );
  const horizontalCm = viewPoint[0];
  const viewY = viewPoint[1];
  const depthCm = viewPoint[2];

  if (view.camera) {
    const { intrinsics, distanceCm } = view.camera;
    const cameraDepth = distanceCm - depthCm;
    if (cameraDepth <= 1) {
      return {
        x: Number.POSITIVE_INFINITY,
        y: Number.POSITIVE_INFINITY,
        depthCm,
      };
    }

    return {
      x:
        intrinsics.cx +
        (intrinsics.fx *
          (horizontalCm -
            view.camera.horizontalOffsetCm)) /
          cameraDepth,
      y:
        intrinsics.cy -
        (intrinsics.fy *
          (viewY - view.camera.verticalOffsetCm)) /
          cameraDepth,
      depthCm,
    };
  }

  const silhouette = view.silhouette;
  const vertical = clamp(
    (bodyHeightCm / 2 - viewY) /
      Math.max(1, bodyHeightCm),
    0,
    1,
  );
  const row = rowGeometry(
    silhouette,
    bodyHeightCm,
    vertical,
  );

  return {
    x:
      row.centerX +
      (horizontalCm / row.metricSpanCm) *
        row.rowWidthPx,
    y:
      silhouette.bounds.y +
      vertical *
        Math.max(1, silhouette.bounds.height - 1),
    depthCm,
  };
}

function bilinear(
  values: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
) {
  if (
    x < 0 ||
    y < 0 ||
    x > width - 1 ||
    y > height - 1
  ) {
    return null;
  }

  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const a = values[y0 * width + x0];
  const b = values[y0 * width + x1];
  const c = values[y1 * width + x0];
  const d = values[y1 * width + x1];
  const top = a + (b - a) * tx;
  const bottom = c + (d - c) * tx;
  return top + (bottom - top) * ty;
}

function maskContains(
  view: MvsView,
  x: number,
  y: number,
) {
  const px = Math.round(x);
  const py = Math.round(y);
  if (
    px < 0 ||
    py < 0 ||
    px >= view.image.width ||
    py >= view.image.height
  ) {
    return false;
  }
  return Boolean(
    view.mask[py * view.image.width + px],
  );
}

function maxHullSurfaceDepth(
  hull: BodyVisualHull,
  view: BodyViewId,
) {
  const vertices =
    hull.multiViewStereo?.surfaceVertices ??
    hull.photometricRefinement?.surfaceVertices ??
    hull.vertices;

  if (vertices.length >= 3) {
    let maximum = -Infinity;
    for (let offset = 0; offset < vertices.length; offset += 3) {
      maximum = Math.max(
        maximum,
        nominalWorldDepth(
          view,
          vertices[offset],
          vertices[offset + 2],
        ),
      );
    }
    if (Number.isFinite(maximum)) {
      return maximum;
    }
  }

  return depthBounds(hull, view).max;
}

function depthBounds(
  hull: BodyVisualHull,
  view: BodyViewId,
  pose?: TurntablePose,
) {
  const minX = hull.originCm[0];
  const minY = hull.originCm[1];
  const minZ = hull.originCm[2];
  const maxX = minX + hull.boundsCm.width;
  const maxY = minY + hull.boundsCm.height;
  const maxZ = minZ + hull.boundsCm.depth;
  const values: number[] = [];

  for (const x of [minX, maxX]) {
    for (const y of [minY, maxY]) {
      for (const z of [minZ, maxZ]) {
        values.push(
          bodyToViewPoint(
            view,
            [x, y, z],
            pose,
          )[2],
        );
      }
    }
  }

  return {
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

function frontHullDepth(params: {
  hull: BodyVisualHull;
  viewId: BodyViewId;
  reference: MvsView;
  bodyHeightCm: number;
  pixelX: number;
  pixelY: number;
}) {
  const sdf = params.hull.signedDistanceField;
  if (!sdf) return null;

  const bounds = depthBounds(
    params.hull,
    params.viewId,
    params.reference.pose,
  );
  const step = Math.max(
    0.55,
    Math.min(
      ...(params.hull.gridStepCm ?? [
        params.hull.voxelSizeCm,
        params.hull.voxelSizeCm,
        params.hull.voxelSizeCm,
      ]),
    ) * 0.85,
  );

  let previousDepth = bounds.max + step;
  let previousDistance = 1;

  for (
    let depth = bounds.max;
    depth >= bounds.min;
    depth -= step
  ) {
    const coordinate = pixelToViewCoordinates(
      params.reference,
      params.bodyHeightCm,
      params.pixelX,
      params.pixelY,
      depth,
    );
    const [x, y, z] = viewCoordinatesToWorld(
      params.viewId,
      coordinate.horizontalCm,
      coordinate.y,
      depth,
      params.reference.pose,
    );
    const distance = sampleSignedDistance(
      sdf,
      x,
      y,
      z,
    );

    if (distance <= 0.15) {
      let outside = previousDepth;
      let inside = depth;
      let outsideDistance = previousDistance;

      for (let iteration = 0; iteration < 5; iteration += 1) {
        const mid = (outside + inside) / 2;
        const coordinate = pixelToViewCoordinates(
          params.reference,
          params.bodyHeightCm,
          params.pixelX,
          params.pixelY,
          mid,
        );
        const point = viewCoordinatesToWorld(
          params.viewId,
          coordinate.horizontalCm,
          coordinate.y,
          mid,
          params.reference.pose,
        );
        const midDistance = sampleSignedDistance(
          sdf,
          point[0],
          point[1],
          point[2],
        );
        if (midDistance > 0) {
          outside = mid;
          outsideDistance = midDistance;
        } else {
          inside = mid;
        }
      }

      void outsideDistance;
      return (outside + inside) / 2;
    }

    previousDepth = depth;
    previousDistance = distance;
  }

  return null;
}

function neighborViews(
  view: BodyViewId,
  offsets: number[] = [-1, 1, -2, 2],
) {
  const index = BODY_VIEW_SEQUENCE.indexOf(view);
  return offsets.map(
    (offset) =>
      BODY_VIEW_SEQUENCE[
        (index + offset + BODY_VIEW_SEQUENCE.length) %
          BODY_VIEW_SEQUENCE.length
      ],
  );
}

const PATCH_OFFSETS = [
  [-2, -2],
  [0, -2],
  [2, -2],
  [-2, 0],
  [0, 0],
  [2, 0],
  [-2, 2],
  [0, 2],
  [2, 2],
] as const;

function robustPatchScore(params: {
  referenceView: BodyViewId;
  targetView: BodyViewId;
  reference: MvsView;
  target: MvsView;
  bodyHeightCm: number;
  centerPixelX: number;
  centerPixelY: number;
  candidateDepthCm: number;
  pyramidLevel?: number;
}) {
  const referenceLevel =
    params.reference.pyramid[
      Math.min(
        params.pyramidLevel ?? 0,
        params.reference.pyramid.length - 1,
      )
    ];
  const targetLevel =
    params.target.pyramid[
      Math.min(
        params.pyramidLevel ?? 0,
        params.target.pyramid.length - 1,
      )
    ];
  const offsetScale =
    1 / Math.max(1e-6, referenceLevel.scale);
  const referenceCenterCoordinate =
    pixelToViewCoordinates(
      params.reference,
      params.bodyHeightCm,
      params.centerPixelX,
      params.centerPixelY,
      params.candidateDepthCm,
    );
  const centerWorld = viewCoordinatesToWorld(
    params.referenceView,
    referenceCenterCoordinate.horizontalCm,
    referenceCenterCoordinate.y,
    params.candidateDepthCm,
    params.reference.pose,
  );
  const targetCenter = worldToPixel(
    params.targetView,
    params.target,
    params.bodyHeightCm,
    centerWorld[0],
    centerWorld[1],
    centerWorld[2],
  );

  if (
    !maskContains(
      params.reference,
      params.centerPixelX,
      params.centerPixelY,
    ) ||
    !maskContains(
      params.target,
      targetCenter.x,
      targetCenter.y,
    )
  ) {
    return null;
  }

  const refCenter = bilinear(
    referenceLevel.luminance,
    referenceLevel.width,
    referenceLevel.height,
    params.centerPixelX * referenceLevel.scale,
    params.centerPixelY * referenceLevel.scale,
  );
  const targetCenterValue = bilinear(
    targetLevel.luminance,
    targetLevel.width,
    targetLevel.height,
    targetCenter.x * targetLevel.scale,
    targetCenter.y * targetLevel.scale,
  );
  if (
    refCenter === null ||
    targetCenterValue === null
  ) {
    return null;
  }

  const refValues: number[] = [];
  const targetValues: number[] = [];
  let refCensus = 0;
  let targetCensus = 0;
  let censusBits = 0;
  let gradientSimilaritySum = 0;
  let gradientSamples = 0;

  for (const [dx, dy] of PATCH_OFFSETS) {
    const refX =
      params.centerPixelX + dx * offsetScale;
    const refY =
      params.centerPixelY + dy * offsetScale;
    if (!maskContains(params.reference, refX, refY)) {
      continue;
    }

    const refCoordinate = pixelToViewCoordinates(
      params.reference,
      params.bodyHeightCm,
      refX,
      refY,
      params.candidateDepthCm,
    );
    const world = viewCoordinatesToWorld(
      params.referenceView,
      refCoordinate.horizontalCm,
      refCoordinate.y,
      params.candidateDepthCm,
      params.reference.pose,
    );
    const projected = worldToPixel(
      params.targetView,
      params.target,
      params.bodyHeightCm,
      world[0],
      world[1],
      world[2],
    );

    if (
      !maskContains(
        params.target,
        projected.x,
        projected.y,
      )
    ) {
      continue;
    }

    const a = bilinear(
      referenceLevel.luminance,
      referenceLevel.width,
      referenceLevel.height,
      refX * referenceLevel.scale,
      refY * referenceLevel.scale,
    );
    const b = bilinear(
      targetLevel.luminance,
      targetLevel.width,
      targetLevel.height,
      projected.x * targetLevel.scale,
      projected.y * targetLevel.scale,
    );
    if (a === null || b === null) continue;

    refValues.push(a);
    targetValues.push(b);

    const refGradient = bilinear(
      referenceLevel.gradient,
      referenceLevel.width,
      referenceLevel.height,
      refX * referenceLevel.scale,
      refY * referenceLevel.scale,
    );
    const targetGradient = bilinear(
      targetLevel.gradient,
      targetLevel.width,
      targetLevel.height,
      projected.x * targetLevel.scale,
      projected.y * targetLevel.scale,
    );
    if (
      refGradient !== null &&
      targetGradient !== null
    ) {
      gradientSimilaritySum +=
        1 -
        Math.abs(refGradient - targetGradient) /
          (refGradient + targetGradient + 18);
      gradientSamples += 1;
    }

    if (
      (dx !== 0 || dy !== 0) &&
      censusBits < 31
    ) {
      if (a >= refCenter) {
        refCensus |= 1 << censusBits;
      }
      if (b >= targetCenterValue) {
        targetCensus |= 1 << censusBits;
      }
      censusBits += 1;
    }
  }

  if (refValues.length < 6 || censusBits < 5) {
    return null;
  }

  const patch = patchStatistics(
    refValues,
    targetValues,
  );
  const zncc = patch.zncc;
  const censusSimilarity =
    1 -
    censusHamming32(refCensus, targetCensus) /
      Math.max(1, censusBits);
  const gradientSimilarity =
    gradientSamples > 0
      ? clamp(
          gradientSimilaritySum / gradientSamples,
          0,
          1,
        )
      : 0;

  const textureEnergy = patch.textureEnergy;
  const robustScore =
    Math.max(0, zncc) * 0.58 +
    censusSimilarity * 0.27 +
    gradientSimilarity * 0.15;

  return clamp(
    robustScore * (textureEnergy < 2.5 ? 0.78 : 1),
    0,
    1,
  );
}

function scoreCandidate(params: {
  referenceView: BodyViewId;
  views: Record<BodyViewId, MvsView>;
  bodyHeightCm: number;
  pixelX: number;
  pixelY: number;
  depthCm: number;
  pyramidLevel?: number;
}) {
  const scores: number[] = [];

  const evaluate = (offsets: number[]) => {
    for (const targetView of neighborViews(
      params.referenceView,
      offsets,
    )) {
      if (
        params.views[targetView].bundleAccepted ===
        false
      ) {
        continue;
      }
      const score = robustPatchScore({
        referenceView: params.referenceView,
        targetView,
        reference:
          params.views[params.referenceView],
        target: params.views[targetView],
        bodyHeightCm: params.bodyHeightCm,
        centerPixelX: params.pixelX,
        centerPixelY: params.pixelY,
        candidateDepthCm: params.depthCm,
        pyramidLevel: params.pyramidLevel,
      });
      if (score !== null) scores.push(score);
    }
  };

  evaluate([-1, 1]);
  if (scores.length < 2) {
    evaluate([-2, 2]);
  }

  if (scores.length < 2) return null;
  scores.sort((a, b) => b - a);
  const selected = scores.slice(
    0,
    Math.min(3, scores.length),
  );
  return (
    selected.reduce((sum, value) => sum + value, 0) /
    selected.length
  );
}

export function parabolicSubpixelCorrection(
  minusScore: number,
  centerScore: number,
  plusScore: number,
  stepCm: number,
) {
  const curvature =
    minusScore -
    2 * centerScore +
    plusScore;
  if (
    !Number.isFinite(curvature) ||
    curvature >= -1e-4 ||
    stepCm <= 0
  ) {
    return 0;
  }

  return clamp(
    (0.5 *
      stepCm *
      (minusScore - plusScore)) /
      curvature,
    -stepCm,
    stepCm,
  );
}

function quantizeDepth(value: number) {
  return clamp(
    Math.round(value / DEPTH_QUANTIZATION_CM),
    -32767,
    32767,
  );
}

function decodeDepth(
  map: BodyDepthMap,
  index: number,
) {
  const value = map.depthValues[index];
  if (value === INVALID_DEPTH) return null;
  return value * map.depthQuantizationCm;
}

function createRawDepthMap(params: {
  view: BodyViewId;
  views: Record<BodyViewId, MvsView>;
  hull: BodyVisualHull;
  bodyHeightCm: number;
  targetWidth?: number;
}): BodyDepthMap {
  const reference = params.views[params.view];
  const width = clamp(
    Math.round(params.targetWidth ?? 30),
    28,
    48,
  );
  const aspect =
    reference.silhouette.bounds.height /
    Math.max(1, reference.silhouette.bounds.width);
  const height = clamp(
    Math.round(width * aspect),
    Math.round(width * 1.8),
    Math.round(width * 2.7),
  );
  const depthValues = new Int16Array(width * height);
  depthValues.fill(INVALID_DEPTH);
  const confidence = new Uint8Array(width * height);

  if (reference.bundleAccepted === false) {
    return {
      version: 2,
      method: "turntable-robust-coarse-to-fine-v2",
      view: params.view,
      width,
      height,
      depthQuantizationCm: DEPTH_QUANTIZATION_CM,
      depthValues,
      confidence,
      validCount: 0,
      meanConfidence: 0,
      subpixelRefinedCount: 0,
      meanSubpixelOffsetCm: 0,
    };
  }
  let validCount = 0;
  let confidenceSum = 0;
  let subpixelRefinedCount = 0;
  let subpixelOffsetSum = 0;

  const coarseOffsets = [
    0,
    1.2,
    2.6,
    4,
    5.2,
  ];
  const maxInwardCm = 5.6;

  for (let gy = 0; gy < height; gy += 1) {
    const pixelY =
      reference.silhouette.bounds.y +
      ((gy + 0.5) / height) *
        reference.silhouette.bounds.height;

    for (let gx = 0; gx < width; gx += 1) {
      const pixelX =
        reference.silhouette.bounds.x +
        ((gx + 0.5) / width) *
          reference.silhouette.bounds.width;
      if (!maskContains(reference, pixelX, pixelY)) {
        continue;
      }

      const hullDepth = frontHullDepth({
        hull: params.hull,
        viewId: params.view,
        reference,
        bodyHeightCm: params.bodyHeightCm,
        pixelX,
        pixelY,
      });
      if (hullDepth === null) continue;

      const evaluateDepth = (candidateDepth: number) => {
        if (
          candidateDepth > hullDepth + 1e-6 ||
          candidateDepth <
            hullDepth - maxInwardCm - 1e-6
        ) {
          return null;
        }

        const coordinate = pixelToViewCoordinates(
          reference,
          params.bodyHeightCm,
          pixelX,
          pixelY,
          candidateDepth,
        );
        const world = viewCoordinatesToWorld(
          params.view,
          coordinate.horizontalCm,
          coordinate.y,
          candidateDepth,
          reference.pose,
        );
        const sdf = params.hull.signedDistanceField;
        if (
          sdf &&
          sampleSignedDistance(
            sdf,
            world[0],
            world[1],
            world[2],
          ) > 0.3
        ) {
          return null;
        }

        return scoreCandidate({
          referenceView: params.view,
          views: params.views,
          bodyHeightCm: params.bodyHeightCm,
          pixelX,
          pixelY,
          depthCm: candidateDepth,
          pyramidLevel: 2,
        });
      };

      const coarse: Array<{
        depth: number;
        score: number;
      }> = [];

      for (const inward of coarseOffsets) {
        const depth = hullDepth - inward;
        const score = evaluateDepth(depth);
        if (score !== null) {
          coarse.push({ depth, score });
        }
      }

      if (coarse.length < 2) continue;
      coarse.sort((a, b) => b.score - a.score);
      const ambiguityMargin =
        coarse[0].score - coarse[1].score;

      let bestDepth = coarse[0].depth;
      let bestScore = coarse[0].score;

      const fineDepths = [
        bestDepth - 0.42,
        bestDepth + 0.42,
      ];

      for (const depth of fineDepths) {
        const coordinate = pixelToViewCoordinates(
          reference,
          params.bodyHeightCm,
          pixelX,
          pixelY,
          depth,
        );
        const world = viewCoordinatesToWorld(
          params.view,
          coordinate.horizontalCm,
          coordinate.y,
          depth,
          reference.pose,
        );
        const sdf = params.hull.signedDistanceField;
        if (
          sdf &&
          sampleSignedDistance(
            sdf,
            world[0],
            world[1],
            world[2],
          ) > 0.3
        ) {
          continue;
        }

        const score = scoreCandidate({
          referenceView: params.view,
          views: params.views,
          bodyHeightCm: params.bodyHeightCm,
          pixelX,
          pixelY,
          depthCm: depth,
          pyramidLevel: 1,
        });
        if (score !== null && score > bestScore) {
          bestDepth = depth;
          bestScore = score;
        }
      }

      const subpixelStepCm = 0.16;
      const evaluateFullResolution = (
        candidateDepth: number,
      ) =>
        scoreCandidate({
          referenceView: params.view,
          views: params.views,
          bodyHeightCm: params.bodyHeightCm,
          pixelX,
          pixelY,
          depthCm: candidateDepth,
          pyramidLevel: 0,
        });

      const centerFineScore =
        evaluateFullResolution(bestDepth);
      if (centerFineScore !== null) {
        bestScore = centerFineScore;
      }

      const minusScore = evaluateFullResolution(
        bestDepth - subpixelStepCm,
      );
      const plusScore = evaluateFullResolution(
        bestDepth + subpixelStepCm,
      );

      if (
        minusScore !== null &&
        plusScore !== null
      ) {
        const correction =
          parabolicSubpixelCorrection(
            minusScore,
            bestScore,
            plusScore,
            subpixelStepCm,
          );

        if (Math.abs(correction) > 0) {
          const refinedDepth = bestDepth + correction;
          const refinedScore =
            evaluateFullResolution(refinedDepth);

          if (
            refinedScore !== null &&
            refinedScore >= bestScore - 0.004
          ) {
            bestDepth = refinedDepth;
            bestScore = Math.max(
              bestScore,
              refinedScore,
            );
            if (Math.abs(correction) >= 0.015) {
              subpixelRefinedCount += 1;
              subpixelOffsetSum += Math.abs(correction);
            }
          }
        }
      }

      if (
        bestScore < 0.42 ||
        ambiguityMargin < 0.01
      ) {
        continue;
      }

      const confidenceValue = clamp(
        ((bestScore - 0.35) / 0.6) * 0.76 +
          (ambiguityMargin / 0.15) * 0.24,
        0,
        1,
      );
      if (confidenceValue < 0.18) continue;

      const index = gy * width + gx;
      depthValues[index] = quantizeDepth(bestDepth);
      confidence[index] = Math.round(
        confidenceValue * 255,
      );
      validCount += 1;
      confidenceSum += confidenceValue;
    }
  }

  return {
    version: 2,
    method: "turntable-robust-coarse-to-fine-v2",
    view: params.view,
    width,
    height,
    depthQuantizationCm: DEPTH_QUANTIZATION_CM,
    depthValues,
    confidence,
    validCount,
    meanConfidence: validCount
      ? confidenceSum / validCount
      : 0,
    subpixelRefinedCount,
    meanSubpixelOffsetCm:
      subpixelRefinedCount > 0
        ? subpixelOffsetSum / subpixelRefinedCount
        : 0,
  };
}

function depthMapCoordinates(
  map: BodyDepthMap,
  silhouette: BodySilhouette,
  pixelX: number,
  pixelY: number,
) {
  return {
    x:
      ((pixelX - silhouette.bounds.x) /
        Math.max(1, silhouette.bounds.width)) *
        map.width -
      0.5,
    y:
      ((pixelY - silhouette.bounds.y) /
        Math.max(1, silhouette.bounds.height)) *
        map.height -
      0.5,
  };
}

function sampleDepthMap(
  map: BodyDepthMap,
  silhouette: BodySilhouette,
  pixelX: number,
  pixelY: number,
) {
  const coordinate = depthMapCoordinates(
    map,
    silhouette,
    pixelX,
    pixelY,
  );
  const x0 = Math.floor(coordinate.x);
  const y0 = Math.floor(coordinate.y);
  const tx = coordinate.x - x0;
  const ty = coordinate.y - y0;
  const taps = [
    [x0, y0, (1 - tx) * (1 - ty)],
    [x0 + 1, y0, tx * (1 - ty)],
    [x0, y0 + 1, (1 - tx) * ty],
    [x0 + 1, y0 + 1, tx * ty],
  ] as const;

  let depthSum = 0;
  let confidenceSum = 0;
  let weightSum = 0;

  for (const [x, y, interpolation] of taps) {
    if (
      x < 0 ||
      y < 0 ||
      x >= map.width ||
      y >= map.height ||
      interpolation <= 0
    ) {
      continue;
    }

    const index = y * map.width + x;
    const depth = decodeDepth(map, index);
    const confidence = map.confidence[index] / 255;
    if (depth === null || confidence <= 0) continue;
    const weight = interpolation * confidence;
    depthSum += depth * weight;
    confidenceSum += confidence * interpolation;
    weightSum += weight;
  }

  if (weightSum < 0.08) return null;
  return {
    depth: depthSum / weightSum,
    confidence: clamp(
      confidenceSum,
      0,
      1,
    ),
  };
}

function regularizeDepthMap(map: BodyDepthMap) {
  const nextDepth = new Int16Array(map.depthValues);
  const nextConfidence = new Uint8Array(map.confidence);

  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      const index = y * map.width + x;
      const center = decodeDepth(map, index);
      if (center === null) continue;

      const neighbors: Array<{
        depth: number;
        confidence: number;
      }> = [];

      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const px = x + dx;
          const py = y + dy;
          if (
            px < 0 ||
            py < 0 ||
            px >= map.width ||
            py >= map.height
          ) {
            continue;
          }
          const neighborIndex = py * map.width + px;
          const depth = decodeDepth(map, neighborIndex);
          const confidence =
            map.confidence[neighborIndex] / 255;
          if (depth === null || confidence < 0.14) continue;
          neighbors.push({ depth, confidence });
        }
      }

      if (neighbors.length < 2) {
        nextConfidence[index] = Math.round(
          nextConfidence[index] * 0.72,
        );
        continue;
      }

      const ordered = neighbors
        .map((item) => item.depth)
        .sort((a, b) => a - b);
      const median =
        ordered[Math.floor(ordered.length / 2)];
      const deviation = Math.abs(center - median);

      if (neighbors.length >= 4 && deviation <= 2.6) {
        const blended =
          center * 0.72 + median * 0.28;
        nextDepth[index] = quantizeDepth(blended);
        const support = clamp(
          neighbors.length / 8,
          0,
          1,
        );
        nextConfidence[index] = Math.round(
          clamp(
            nextConfidence[index] / 255 *
              (0.88 + support * 0.12),
            0,
            1,
          ) * 255,
        );
      } else if (deviation > 3.2) {
        nextConfidence[index] = Math.round(
          nextConfidence[index] * 0.55,
        );
      }
    }
  }

  map.depthValues.set(nextDepth);
  map.confidence.set(nextConfidence);
}


function edgeAwareUpsampleDepthMap(
  map: BodyDepthMap,
  view: MvsView,
) {
  if (
    map.validCount < 2 ||
    view.bundleAccepted === false
  ) {
    return map;
  }

  const targetWidth = clamp(
    Math.round(map.width * 1.45),
    map.width,
    72,
  );
  const targetHeight = Math.max(
    map.height,
    Math.round(
      map.height * (targetWidth / map.width),
    ),
  );
  if (
    targetWidth === map.width &&
    targetHeight === map.height
  ) {
    return map;
  }

  const depthValues = new Int16Array(
    targetWidth * targetHeight,
  );
  depthValues.fill(INVALID_DEPTH);
  const confidence = new Uint8Array(
    targetWidth * targetHeight,
  );
  let validCount = 0;
  let confidenceSum = 0;
  let propagatedCount = 0;

  for (let ty = 0; ty < targetHeight; ty += 1) {
    const pixelY =
      view.silhouette.bounds.y +
      ((ty + 0.5) / targetHeight) *
        view.silhouette.bounds.height;
    const sourceY =
      ((pixelY - view.silhouette.bounds.y) /
        Math.max(1, view.silhouette.bounds.height)) *
        map.height -
      0.5;

    for (let tx = 0; tx < targetWidth; tx += 1) {
      const pixelX =
        view.silhouette.bounds.x +
        ((tx + 0.5) / targetWidth) *
          view.silhouette.bounds.width;
      if (!maskContains(view, pixelX, pixelY)) {
        continue;
      }

      const centerLuma = bilinear(
        view.luminance,
        view.image.width,
        view.image.height,
        pixelX,
        pixelY,
      );
      const centerGradient = bilinear(
        view.gradient,
        view.image.width,
        view.image.height,
        pixelX,
        pixelY,
      );
      if (
        centerLuma === null ||
        centerGradient === null
      ) {
        continue;
      }

      const sourceX =
        ((pixelX - view.silhouette.bounds.x) /
          Math.max(1, view.silhouette.bounds.width)) *
          map.width -
        0.5;
      const baseX = Math.round(sourceX);
      const baseY = Math.round(sourceY);
      let weightedDepth = 0;
      let weightSum = 0;
      let confidenceWeighted = 0;
      let support = 0;
      let minDepth = Infinity;
      let maxDepth = -Infinity;
      let nearestWasValid = false;

      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const sx = baseX + dx;
          const sy = baseY + dy;
          if (
            sx < 0 ||
            sy < 0 ||
            sx >= map.width ||
            sy >= map.height
          ) {
            continue;
          }
          const sourceIndex = sy * map.width + sx;
          const depth = decodeDepth(map, sourceIndex);
          const sourceConfidence =
            map.confidence[sourceIndex] / 255;
          if (
            depth === null ||
            sourceConfidence < 0.08
          ) {
            continue;
          }

          const sourcePixelX =
            view.silhouette.bounds.x +
            ((sx + 0.5) / map.width) *
              view.silhouette.bounds.width;
          const sourcePixelY =
            view.silhouette.bounds.y +
            ((sy + 0.5) / map.height) *
              view.silhouette.bounds.height;
          const luma = bilinear(
            view.luminance,
            view.image.width,
            view.image.height,
            sourcePixelX,
            sourcePixelY,
          );
          const gradient = bilinear(
            view.gradient,
            view.image.width,
            view.image.height,
            sourcePixelX,
            sourcePixelY,
          );
          if (luma === null || gradient === null) {
            continue;
          }

          const spatialDistance = Math.hypot(
            sx - sourceX,
            sy - sourceY,
          );
          const spatialWeight = Math.exp(
            -spatialDistance * spatialDistance * 0.72,
          );
          const appearanceWeight = Math.exp(
            -Math.abs(luma - centerLuma) / 20,
          );
          const edgeWeight = Math.exp(
            -Math.abs(gradient - centerGradient) / 24,
          );
          const weight =
            spatialWeight *
            appearanceWeight *
            edgeWeight *
            sourceConfidence;
          if (weight < 0.008) continue;

          weightedDepth += depth * weight;
          confidenceWeighted +=
            sourceConfidence * weight;
          weightSum += weight;
          support += 1;
          minDepth = Math.min(minDepth, depth);
          maxDepth = Math.max(maxDepth, depth);
          if (
            sx === Math.round(sourceX) &&
            sy === Math.round(sourceY)
          ) {
            nearestWasValid = true;
          }
        }
      }

      if (
        support < 2 ||
        weightSum < 0.1 ||
        maxDepth - minDepth > 2.4
      ) {
        continue;
      }

      const denseDepth = weightedDepth / weightSum;
      const denseConfidence = clamp(
        (confidenceWeighted / weightSum) *
          (nearestWasValid ? 0.96 : 0.72) *
          clamp(support / 5, 0.45, 1),
        0,
        1,
      );
      if (denseConfidence < 0.1) continue;

      const targetIndex =
        ty * targetWidth + tx;
      depthValues[targetIndex] =
        quantizeDepth(denseDepth);
      confidence[targetIndex] = Math.round(
        denseConfidence * 255,
      );
      validCount += 1;
      confidenceSum += denseConfidence;
      if (!nearestWasValid) {
        propagatedCount += 1;
      }
    }
  }

  return {
    ...map,
    version: 3 as const,
    method: "turntable-edge-aware-dense-v3" as const,
    width: targetWidth,
    height: targetHeight,
    depthValues,
    confidence,
    validCount,
    meanConfidence:
      validCount > 0
        ? confidenceSum / validCount
        : 0,
    propagatedCount,
    sourceWidth: map.width,
  };
}

function enforceCrossViewConsistency(params: {
  maps: Record<BodyViewId, BodyDepthMap>;
  views: Record<BodyViewId, MvsView>;
  bodyHeightCm: number;
  toleranceCm: number;
}) {
  let consistentPairs = 0;
  let comparablePairs = 0;

  for (const view of BODY_VIEW_SEQUENCE) {
    const map = params.maps[view];
    const reference = params.views[view];

    for (let gy = 0; gy < map.height; gy += 1) {
      const pixelY =
        reference.silhouette.bounds.y +
        ((gy + 0.5) / map.height) *
          reference.silhouette.bounds.height;

      for (let gx = 0; gx < map.width; gx += 1) {
        const index = gy * map.width + gx;
        const depth = decodeDepth(map, index);
        if (depth === null) continue;

        const pixelX =
          reference.silhouette.bounds.x +
          ((gx + 0.5) / map.width) *
            reference.silhouette.bounds.width;
        const coordinate = pixelToViewCoordinates(
          reference,
          params.bodyHeightCm,
          pixelX,
          pixelY,
          depth,
        );
        const world = viewCoordinatesToWorld(
          view,
          coordinate.horizontalCm,
          coordinate.y,
          depth,
          reference.pose,
        );

        let comparable = 0;
        let consistent = 0;

        for (const targetView of neighborViews(view)) {
          const target = params.views[targetView];
          const projected = worldToPixel(
            targetView,
            target,
            params.bodyHeightCm,
            world[0],
            world[1],
            world[2],
          );
          if (
            !maskContains(
              target,
              projected.x,
              projected.y,
            )
          ) {
            continue;
          }

          const sample = sampleDepthMap(
            params.maps[targetView],
            target.silhouette,
            projected.x,
            projected.y,
          );
          if (!sample) continue;
          comparable += 1;
          comparablePairs += 1;

          if (
            Math.abs(
              sample.depth - projected.depthCm,
            ) <= params.toleranceCm
          ) {
            consistent += 1;
            consistentPairs += 1;
          }
        }

        if (
          comparable >= 2 &&
          consistent / comparable < 0.34
        ) {
          map.depthValues[index] = INVALID_DEPTH;
          map.confidence[index] = 0;
          map.validCount -= 1;
          continue;
        }

        if (comparable > 0) {
          const ratio = consistent / comparable;
          map.confidence[index] = Math.round(
            map.confidence[index] *
              (0.6 + ratio * 0.4),
          );
        }
      }
    }
  }

  for (const view of BODY_VIEW_SEQUENCE) {
    const map = params.maps[view];
    let sum = 0;
    let count = 0;
    for (const value of map.confidence) {
      if (!value) continue;
      sum += value / 255;
      count += 1;
    }
    map.validCount = count;
    map.meanConfidence = count ? sum / count : 0;
  }

  return comparablePairs
    ? consistentPairs / comparablePairs
    : 0;
}

function tsdfSampleFromMap(params: {
  map: BodyDepthMap;
  view: MvsView;
  viewId: BodyViewId;
  bodyHeightCm: number;
  x: number;
  y: number;
  z: number;
}) {
  const projected = worldToPixel(
    params.viewId,
    params.view,
    params.bodyHeightCm,
    params.x,
    params.y,
    params.z,
  );
  if (
    !maskContains(
      params.view,
      projected.x,
      projected.y,
    )
  ) {
    return null;
  }

  const sample = sampleDepthMap(
    params.map,
    params.view.silhouette,
    projected.x,
    projected.y,
  );
  if (!sample) return null;

  return {
    signedDistanceCm:
      projected.depthCm - sample.depth,
    confidence: sample.confidence,
  };
}

function buildTsdf(params: {
  hull: BodyVisualHull;
  maps: Record<BodyViewId, BodyDepthMap>;
  views: Record<BodyViewId, MvsView>;
  bodyHeightCm: number;
}): BodyTsdfVolume {
  const sdf = params.hull.signedDistanceField;
  if (!sdf) {
    throw new Error(
      "O MVS precisa do SDF conservador do visual hull.",
    );
  }

  const resolution = { ...sdf.resolution };
  const originCm: Vec3 = [...sdf.originCm];
  const stepCm: Vec3 = [...sdf.stepCm];
  const total =
    resolution.x * resolution.y * resolution.z;
  const values = new Int16Array(total);
  const weights = new Uint8Array(total);
  const truncationCm = Math.max(
    2.8,
    params.hull.voxelSizeCm * 2.1,
  );
  const quantizationCm = 0.03;
  const maxQuantized = Math.floor(
    truncationCm / quantizationCm,
  );
  const contributions = new Array<number>(8).fill(0);
  const contributionWeights =
    new Array<number>(8).fill(0);

  for (let gy = 0; gy < resolution.y; gy += 1) {
    const y = originCm[1] + gy * stepCm[1];

    for (let gz = 0; gz < resolution.z; gz += 1) {
      const z = originCm[2] + gz * stepCm[2];

      for (let gx = 0; gx < resolution.x; gx += 1) {
        const x = originCm[0] + gx * stepCm[0];
        const index =
          (gy * resolution.z + gz) *
            resolution.x +
          gx;
        const hullDistance = sampleSignedDistance(
          sdf,
          x,
          y,
          z,
        );

        if (hullDistance > 0) {
          const value = Math.min(
            truncationCm,
            hullDistance,
          );
          values[index] = Math.round(
            value / quantizationCm,
          );
          weights[index] = 255;
          continue;
        }

        if (hullDistance <= -truncationCm) {
          values[index] = -maxQuantized;
          weights[index] = 0;
          continue;
        }

        let contributionCount = 0;

        const radialAngle = Math.atan2(x, z);
        for (const viewId of BODY_VIEW_SEQUENCE) {
          const delta = Math.abs(
            Math.atan2(
              Math.sin(
                radialAngle -
                  (params.views[viewId].pose?.angleRad ??
                    BODY_VIEW_ANGLE_RAD[viewId]),
              ),
              Math.cos(
                radialAngle -
                  BODY_VIEW_ANGLE_RAD[viewId],
              ),
            ),
          );
          if (delta > Math.PI * 0.4) continue;

          const sample = tsdfSampleFromMap({
            map: params.maps[viewId],
            view: params.views[viewId],
            viewId,
            bodyHeightCm: params.bodyHeightCm,
            x,
            y,
            z,
          });
          if (!sample) continue;
          if (
            sample.signedDistanceCm <
            -truncationCm
          ) {
            continue;
          }

          const contribution = clamp(
            sample.signedDistanceCm,
            -truncationCm,
            truncationCm,
          );
          const weight =
            sample.confidence *
            sample.confidence;
          contributions[contributionCount] =
            contribution;
          contributionWeights[contributionCount] =
            weight;
          contributionCount += 1;
        }

        const reduced = weightedMean(
          contributions,
          contributionWeights,
          contributionCount,
        );
        const weightSum = reduced.weightSum;
        const fused =
          weightSum >= 0.24
            ? reduced.value
            : hullDistance;
        const conservative = Math.max(
          hullDistance,
          fused,
        );
        const clamped = clamp(
          conservative,
          -truncationCm,
          truncationCm,
        );
        values[index] = clamp(
          Math.round(clamped / quantizationCm),
          -maxQuantized,
          maxQuantized,
        );
        weights[index] = Math.round(
          clamp(weightSum / 2.4, 0, 1) * 255,
        );
      }
    }
  }

  return {
    version: 1,
    method: "multi-depth-tsdf-fusion-v1",
    resolution,
    originCm,
    stepCm,
    truncationCm,
    quantizationCm,
    values,
    weights,
  };
}

const TETRAHEDRA = [
  [0, 5, 1, 6],
  [0, 1, 2, 6],
  [0, 2, 3, 6],
  [0, 3, 7, 6],
  [0, 7, 4, 6],
  [0, 4, 5, 6],
] as const;

const CUBE_OFFSETS: Vec3[] = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 0, 1],
  [0, 0, 1],
  [0, 1, 0],
  [1, 1, 0],
  [1, 1, 1],
  [0, 1, 1],
];

function computeNormals(
  vertices: number[],
  indices: number[],
) {
  const normals = new Array<number>(vertices.length).fill(0);

  for (let offset = 0; offset < indices.length; offset += 3) {
    const ia = indices[offset] * 3;
    const ib = indices[offset + 1] * 3;
    const ic = indices[offset + 2] * 3;
    const abx = vertices[ib] - vertices[ia];
    const aby = vertices[ib + 1] - vertices[ia + 1];
    const abz = vertices[ib + 2] - vertices[ia + 2];
    const acx = vertices[ic] - vertices[ia];
    const acy = vertices[ic + 1] - vertices[ia + 1];
    const acz = vertices[ic + 2] - vertices[ia + 2];
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;

    for (const index of [ia, ib, ic]) {
      normals[index] += nx;
      normals[index + 1] += ny;
      normals[index + 2] += nz;
    }
  }

  for (let offset = 0; offset < normals.length; offset += 3) {
    const length =
      Math.hypot(
        normals[offset],
        normals[offset + 1],
        normals[offset + 2],
      ) || 1;
    normals[offset] /= length;
    normals[offset + 1] /= length;
    normals[offset + 2] /= length;
  }

  return normals;
}

function extractTsdfSurface(tsdf: BodyTsdfVolume) {
  const { resolution, originCm, stepCm } = tsdf;
  const vertices: number[] = [];
  const indices: number[] = [];
  const edgeMap = new Map<string, number>();

  const gridIndex = (
    x: number,
    y: number,
    z: number,
  ) =>
    (y * resolution.z + z) *
      resolution.x +
    x;

  const point = (
    x: number,
    y: number,
    z: number,
  ): Vec3 => [
    originCm[0] + x * stepCm[0],
    originCm[1] + y * stepCm[1],
    originCm[2] + z * stepCm[2],
  ];

  const value = (index: number) =>
    tsdf.values[index] * tsdf.quantizationCm;

  const edgeVertex = (
    aIndex: number,
    bIndex: number,
    aPoint: Vec3,
    bPoint: Vec3,
    aValue: number,
    bValue: number,
  ) => {
    const key =
      aIndex < bIndex
        ? `${aIndex}:${bIndex}`
        : `${bIndex}:${aIndex}`;
    const existing = edgeMap.get(key);
    if (existing !== undefined) return existing;

    const denominator = aValue - bValue;
    const t =
      Math.abs(denominator) < 1e-8
        ? 0.5
        : clamp(
            aValue / denominator,
            0.05,
            0.95,
          );
    const index = vertices.length / 3;
    vertices.push(
      aPoint[0] +
        (bPoint[0] - aPoint[0]) * t,
      aPoint[1] +
        (bPoint[1] - aPoint[1]) * t,
      aPoint[2] +
        (bPoint[2] - aPoint[2]) * t,
    );
    edgeMap.set(key, index);
    return index;
  };

  const addTriangle = (
    a: number,
    b: number,
    c: number,
    insideReference: Vec3,
  ) => {
    const ao = a * 3;
    const bo = b * 3;
    const co = c * 3;
    const ab: Vec3 = [
      vertices[bo] - vertices[ao],
      vertices[bo + 1] - vertices[ao + 1],
      vertices[bo + 2] - vertices[ao + 2],
    ];
    const ac: Vec3 = [
      vertices[co] - vertices[ao],
      vertices[co + 1] - vertices[ao + 1],
      vertices[co + 2] - vertices[ao + 2],
    ];
    const normal: Vec3 = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ];
    const centroid: Vec3 = [
      (vertices[ao] + vertices[bo] + vertices[co]) / 3,
      (vertices[ao + 1] +
        vertices[bo + 1] +
        vertices[co + 1]) /
        3,
      (vertices[ao + 2] +
        vertices[bo + 2] +
        vertices[co + 2]) /
        3,
    ];
    const outward: Vec3 = [
      centroid[0] - insideReference[0],
      centroid[1] - insideReference[1],
      centroid[2] - insideReference[2],
    ];
    const alignment =
      normal[0] * outward[0] +
      normal[1] * outward[1] +
      normal[2] * outward[2];

    if (alignment < 0) indices.push(a, c, b);
    else indices.push(a, b, c);
  };

  for (let y = 0; y < resolution.y - 1; y += 1) {
    for (let z = 0; z < resolution.z - 1; z += 1) {
      for (let x = 0; x < resolution.x - 1; x += 1) {
        const cornerIndices = CUBE_OFFSETS.map(
          ([dx, dy, dz]) =>
            gridIndex(x + dx, y + dy, z + dz),
        );
        const cornerPoints = CUBE_OFFSETS.map(
          ([dx, dy, dz]) =>
            point(x + dx, y + dy, z + dz),
        );
        const cornerValues = cornerIndices.map(value);
        let hasNegative = false;
        let hasNonNegative = false;
        for (const cornerValue of cornerValues) {
          if (cornerValue < 0) hasNegative = true;
          else hasNonNegative = true;
          if (hasNegative && hasNonNegative) break;
        }
        if (!hasNegative || !hasNonNegative) {
          continue;
        }

        for (const tetra of TETRAHEDRA) {
          const inside = tetra.filter(
            (corner) => cornerValues[corner] < 0,
          );
          if (inside.length === 0 || inside.length === 4) {
            continue;
          }
          const outside = tetra.filter(
            (corner) => cornerValues[corner] >= 0,
          );

          const midpointIndex = (a: number, b: number) =>
            edgeVertex(
              cornerIndices[a],
              cornerIndices[b],
              cornerPoints[a],
              cornerPoints[b],
              cornerValues[a],
              cornerValues[b],
            );

          const reference: Vec3 = [
            inside.reduce<number>(
              (sum, corner) =>
                sum + cornerPoints[corner][0],
              0,
            ) / inside.length,
            inside.reduce<number>(
              (sum, corner) =>
                sum + cornerPoints[corner][1],
              0,
            ) / inside.length,
            inside.reduce<number>(
              (sum, corner) =>
                sum + cornerPoints[corner][2],
              0,
            ) / inside.length,
          ];

          if (inside.length === 1) {
            const i = inside[0];
            addTriangle(
              midpointIndex(i, outside[0]),
              midpointIndex(i, outside[1]),
              midpointIndex(i, outside[2]),
              reference,
            );
            continue;
          }

          if (inside.length === 3) {
            const o = outside[0];
            addTriangle(
              midpointIndex(o, inside[0]),
              midpointIndex(o, inside[2]),
              midpointIndex(o, inside[1]),
              reference,
            );
            continue;
          }

          const a = midpointIndex(
            inside[0],
            outside[0],
          );
          const b = midpointIndex(
            inside[0],
            outside[1],
          );
          const c = midpointIndex(
            inside[1],
            outside[1],
          );
          const d = midpointIndex(
            inside[1],
            outside[0],
          );
          addTriangle(a, b, c, reference);
          addTriangle(a, c, d, reference);
        }
      }
    }
  }

  return {
    vertices,
    normals: computeNormals(vertices, indices),
    indices,
  };
}

export type MultiViewStereoDiagnostics = {
  validDepthCount: number;
  meanConfidence: number;
  crossViewConsistency: number;
  surfaceTriangleCount: number;
  rejection:
    | "none"
    | "missing-eight-view-sdf"
    | "insufficient-depth-confidence"
    | "insufficient-surface";
};

export type BodyMvsBuildInput = {
  hull: BodyVisualHull;
  images: Record<BodyViewId, RgbaImage>;
  masks: Record<BodyViewId, Uint8Array>;
  silhouettes: Record<BodyViewId, BodySilhouette>;
  bodyHeightCm: number;
  optics?: OpticalCalibrationProfile;
  diagnostics?: MultiViewStereoDiagnostics;
  targetDepthWidth?: number;
};

export function buildClassicalMultiViewStereo(
  params: BodyMvsBuildInput,
): BodyMultiViewStereo | null {
  if (params.diagnostics) {
    params.diagnostics.validDepthCount = 0;
    params.diagnostics.meanConfidence = 0;
    params.diagnostics.crossViewConsistency = 0;
    params.diagnostics.surfaceTriangleCount = 0;
    params.diagnostics.rejection = "none";
  }

  if (
    params.hull.viewCount !== 8 ||
    !params.hull.signedDistanceField
  ) {
    if (params.diagnostics) {
      params.diagnostics.rejection = "missing-eight-view-sdf";
    }
    return null;
  }

  const cameraCandidates = Object.fromEntries(
    BODY_VIEW_SEQUENCE.map((view) => [
      view,
      calibratedCameraForView({
        image: params.images[view],
        silhouette: params.silhouettes[view],
        bodyHeightCm: params.bodyHeightCm,
        frontDepthCm: Math.max(
          0,
          maxHullSurfaceDepth(params.hull, view),
        ),
        optics: params.optics,
      }),
    ]),
  ) as Record<
    BodyViewId,
    TurntableCamera | undefined
  >;
  const usePerspective = BODY_VIEW_SEQUENCE.every(
    (view) => Boolean(cameraCandidates[view]),
  );
  const optimizedRig = usePerspective
    ? optimizeTurntableBundleFromSilhouettes({
        candidates: cameraCandidates,
        silhouettes: params.silhouettes,
        images: params.images,
        masks: params.masks,
        bodyHeightCm: params.bodyHeightCm,
      })
    : undefined;
  const activeCameras =
    optimizedRig?.cameras ?? cameraCandidates;
  const activePoses = optimizedRig?.poses;
  const rejectedBundleViews = new Set(
    optimizedRig?.metadata.rejectedViews ?? [],
  );

  const views = Object.fromEntries(
    BODY_VIEW_SEQUENCE.map((view) => {
      const image = params.images[view];
      const luminance = buildLuminance(image);
      const pyramid = buildFeaturePyramid(
        luminance,
        image.width,
        image.height,
      );
      return [
        view,
        {
          image,
          mask: params.masks[view],
          silhouette: params.silhouettes[view],
          luminance,
          gradient: pyramid[0].gradient,
          pyramid,
          camera: usePerspective
            ? activeCameras[view]
            : undefined,
          pose: usePerspective
            ? activePoses?.[view]
            : undefined,
          bundleAccepted:
            !rejectedBundleViews.has(view),
        },
      ];
    }),
  ) as Record<BodyViewId, MvsView>;

  const depthMaps = Object.fromEntries(
    BODY_VIEW_SEQUENCE.map((view) => [
      view,
      createRawDepthMap({
        view,
        views,
        hull: params.hull,
        bodyHeightCm: params.bodyHeightCm,
        targetWidth: params.targetDepthWidth,
      }),
    ]),
  ) as Record<BodyViewId, BodyDepthMap>;

  for (const view of BODY_VIEW_SEQUENCE) {
    regularizeDepthMap(depthMaps[view]);
  }

  const crossViewConsistency =
    enforceCrossViewConsistency({
      maps: depthMaps,
      views,
      bodyHeightCm: params.bodyHeightCm,
      toleranceCm: Math.max(
        1.4,
        params.hull.voxelSizeCm * 0.85,
      ),
    });

  for (const view of BODY_VIEW_SEQUENCE) {
    depthMaps[view] = edgeAwareUpsampleDepthMap(
      depthMaps[view],
      views[view],
    );
  }

  let validDepthCount = 0;
  let confidenceSum = 0;
  let subpixelRefinedCount = 0;
  for (const view of BODY_VIEW_SEQUENCE) {
    const map = depthMaps[view];
    validDepthCount += map.validCount;
    confidenceSum +=
      map.meanConfidence * map.validCount;
    subpixelRefinedCount +=
      map.subpixelRefinedCount ?? 0;
  }

  const meanConfidence = validDepthCount
    ? confidenceSum / validDepthCount
    : 0;

  if (params.diagnostics) {
    params.diagnostics.validDepthCount = validDepthCount;
    params.diagnostics.meanConfidence = meanConfidence;
    params.diagnostics.crossViewConsistency =
      crossViewConsistency;
  }

  if (
    validDepthCount < 120 ||
    meanConfidence < 0.16 ||
    crossViewConsistency < 0.12
  ) {
    if (params.diagnostics) {
      params.diagnostics.rejection =
        "insufficient-depth-confidence";
    }
    return null;
  }

  const tsdf = buildTsdf({
    hull: params.hull,
    maps: depthMaps,
    views,
    bodyHeightCm: params.bodyHeightCm,
  });
  const surface = extractTsdfSurface(tsdf);

  if (params.diagnostics) {
    params.diagnostics.surfaceTriangleCount =
      surface.indices.length / 3;
  }

  if (surface.indices.length < 300) {
    if (params.diagnostics) {
      params.diagnostics.rejection =
        "insufficient-surface";
    }
    return null;
  }

  let fusedVoxelCount = 0;
  for (const weight of tsdf.weights) {
    if (weight > 0) fusedVoxelCount += 1;
  }

  const matchingKernel =
    getCensusPopcountKernel().backend;
  const numericKernel = getMvsNumericBackend();
  const isV11 =
    optimizedRig?.metadata.version === 3;
  const isV10 =
    !isV11 &&
    optimizedRig?.metadata.version === 2 &&
    views.front.pyramid.length >= 2;

  return {
    version: isV11 ? 4 : isV10 ? 3 : 2,
    method: isV11
      ? "turntable-feature-bundle-dense-simd-v4"
      : isV10
        ? "turntable-bundle-pyramid-simd-v3"
        : "turntable-robust-subpixel-tsdf-v2",
    projectionModel: usePerspective
      ? "calibrated-turntable-perspective"
      : "metric-orthographic",
    meanCameraDistanceCm: usePerspective
      ? optimizedRig?.metadata.sharedCameraDistanceCm ??
        median(
          BODY_VIEW_SEQUENCE.map(
            (view) =>
              cameraCandidates[view]?.distanceCm ?? 0,
          ),
        )
      : undefined,
    matchingModel: "zncc-census-gradient",
    depthRefinement: isV11
      ? "coarse-to-fine-parabolic-edge-aware"
      : "coarse-to-fine-parabolic",
    matchingKernel,
    numericKernel,
    executionBackend:
      numericKernel !== "js-scalar"
        ? "main-wasm-simd"
        : matchingKernel === "wasm-popcnt32-v1"
          ? "main-wasm"
          : "main-js",
    subpixelRefinedCount,
    pyramidLevels: views.front.pyramid.length,
    highDensityDepthWidth:
      params.targetDepthWidth ?? 30,
    turntableRig:
      optimizedRig?.metadata ?? {
        version: 1,
        method: "shared-axis-center-least-squares-v1",
        optimized: false,
        axisCenterCm: [0, 0, 0],
        centerResidualCm: 0,
      },
    depthMaps,
    tsdf,
    surfaceVertices: surface.vertices,
    surfaceNormals: surface.normals,
    surfaceIndices: surface.indices,
    validDepthCount,
    meanConfidence,
    crossViewConsistency,
    fusedVoxelCount,
  };
}
