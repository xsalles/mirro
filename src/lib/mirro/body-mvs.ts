import type { RgbaImage } from "./body-calibration";
import {
  BODY_VIEW_ANGLE_RAD,
  BODY_VIEW_SEQUENCE,
} from "./body-views";
import { sampleSignedDistance } from "./signed-distance-field";
import { scaleOpticalIntrinsics } from "./optical-calibration";
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

type MvsView = {
  image: RgbaImage;
  mask: Uint8Array;
  silhouette: BodySilhouette;
  luminance: Float32Array;
  camera?: TurntableCamera;
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

function viewCoordinatesToWorld(
  view: BodyViewId,
  horizontalCm: number,
  y: number,
  depthCm: number,
): Vec3 {
  const angle = BODY_VIEW_ANGLE_RAD[view];
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [
    horizontalCm * cos + depthCm * sin,
    y,
    -horizontalCm * sin + depthCm * cos,
  ];
}

function worldDepth(
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

function worldHorizontal(
  view: BodyViewId,
  x: number,
  z: number,
) {
  const angle = BODY_VIEW_ANGLE_RAD[view];
  return (
    x * Math.cos(angle) -
    z * Math.sin(angle)
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
  const depthCm = worldDepth(viewId, x, z);
  const horizontalCm = worldHorizontal(
    viewId,
    x,
    z,
  );

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
          (y - view.camera.verticalOffsetCm)) /
          cameraDepth,
      depthCm,
    };
  }

  const silhouette = view.silhouette;
  const vertical = clamp(
    (bodyHeightCm / 2 - y) /
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
        worldDepth(
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
) {
  const minX = hull.originCm[0];
  const minZ = hull.originCm[2];
  const maxX = minX + hull.boundsCm.width;
  const maxZ = minZ + hull.boundsCm.depth;
  const values = [
    worldDepth(view, minX, minZ),
    worldDepth(view, minX, maxZ),
    worldDepth(view, maxX, minZ),
    worldDepth(view, maxX, maxZ),
  ];
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

  const bounds = depthBounds(params.hull, params.viewId);
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

function patchZncc(params: {
  referenceView: BodyViewId;
  targetView: BodyViewId;
  reference: MvsView;
  target: MvsView;
  bodyHeightCm: number;
  centerPixelX: number;
  centerPixelY: number;
  candidateDepthCm: number;
}) {
  const refValues: number[] = [];
  const targetValues: number[] = [];

  for (const [dx, dy] of PATCH_OFFSETS) {
    const refX = params.centerPixelX + dx;
    const refY = params.centerPixelY + dy;
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
      params.reference.luminance,
      params.reference.image.width,
      params.reference.image.height,
      refX,
      refY,
    );
    const b = bilinear(
      params.target.luminance,
      params.target.image.width,
      params.target.image.height,
      projected.x,
      projected.y,
    );

    if (a === null || b === null) continue;
    refValues.push(a);
    targetValues.push(b);
  }

  if (refValues.length < 6) return null;

  let meanA = 0;
  let meanB = 0;
  for (let index = 0; index < refValues.length; index += 1) {
    meanA += refValues[index];
    meanB += targetValues[index];
  }
  meanA /= refValues.length;
  meanB /= targetValues.length;

  let covariance = 0;
  let varianceA = 0;
  let varianceB = 0;

  for (let index = 0; index < refValues.length; index += 1) {
    const da = refValues[index] - meanA;
    const db = targetValues[index] - meanB;
    covariance += da * db;
    varianceA += da * da;
    varianceB += db * db;
  }

  const denominator = Math.sqrt(
    varianceA * varianceB,
  );
  if (denominator < 80) return null;
  return clamp(covariance / denominator, -1, 1);
}

function scoreCandidate(params: {
  referenceView: BodyViewId;
  views: Record<BodyViewId, MvsView>;
  bodyHeightCm: number;
  pixelX: number;
  pixelY: number;
  depthCm: number;
}) {
  const correlations: number[] = [];

  const evaluate = (offsets: number[]) => {
    for (const targetView of neighborViews(
      params.referenceView,
      offsets,
    )) {
      const correlation = patchZncc({
        referenceView: params.referenceView,
        targetView,
        reference: params.views[params.referenceView],
        target: params.views[targetView],
        bodyHeightCm: params.bodyHeightCm,
        centerPixelX: params.pixelX,
        centerPixelY: params.pixelY,
        candidateDepthCm: params.depthCm,
      });
      if (correlation !== null) {
        correlations.push(correlation);
      }
    }
  };

  evaluate([-1, 1]);
  if (correlations.length < 2) {
    evaluate([-2, 2]);
  }

  if (correlations.length < 2) return null;
  correlations.sort((a, b) => b - a);
  const selected = correlations.slice(
    0,
    Math.min(3, correlations.length),
  );
  return (
    selected.reduce((sum, value) => sum + value, 0) /
    selected.length
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
}): BodyDepthMap {
  const reference = params.views[params.view];
  const width = 30;
  const aspect =
    reference.silhouette.bounds.height /
    Math.max(1, reference.silhouette.bounds.width);
  const height = clamp(
    Math.round(width * aspect),
    54,
    80,
  );
  const depthValues = new Int16Array(width * height);
  depthValues.fill(INVALID_DEPTH);
  const confidence = new Uint8Array(width * height);
  let validCount = 0;
  let confidenceSum = 0;

  const inwardOffsets = [
    0,
    0.35,
    0.7,
    1.1,
    1.6,
    2.2,
    3,
    4,
    5.2,
  ];

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

      let bestDepth = hullDepth;
      let bestCorrelation = -Infinity;
      let secondCorrelation = -Infinity;

      for (const inward of inwardOffsets) {
        const candidateDepth = hullDepth - inward;
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

        const correlation = scoreCandidate({
          referenceView: params.view,
          views: params.views,
          bodyHeightCm: params.bodyHeightCm,
          pixelX,
          pixelY,
          depthCm: candidateDepth,
        });
        if (correlation === null) continue;

        if (correlation > bestCorrelation) {
          secondCorrelation = bestCorrelation;
          bestCorrelation = correlation;
          bestDepth = candidateDepth;
        } else if (correlation > secondCorrelation) {
          secondCorrelation = correlation;
        }
      }

      if (!Number.isFinite(bestCorrelation)) continue;
      const margin = Number.isFinite(secondCorrelation)
        ? bestCorrelation - secondCorrelation
        : 0.12;
      if (bestCorrelation < 0.2 || margin < 0.012) {
        continue;
      }

      const confidenceValue = clamp(
        ((bestCorrelation - 0.15) / 0.75) * 0.72 +
          (margin / 0.16) * 0.28,
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
    version: 1,
    method: "turntable-zncc-plane-sweep-v1",
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

        let sum = 0;
        let weightSum = 0;

        const radialAngle = Math.atan2(x, z);
        for (const viewId of BODY_VIEW_SEQUENCE) {
          const delta = Math.abs(
            Math.atan2(
              Math.sin(
                radialAngle -
                  BODY_VIEW_ANGLE_RAD[viewId],
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
          sum += contribution * weight;
          weightSum += weight;
        }

        const fused =
          weightSum >= 0.24
            ? sum / weightSum
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

export function buildClassicalMultiViewStereo(params: {
  hull: BodyVisualHull;
  images: Record<BodyViewId, RgbaImage>;
  masks: Record<BodyViewId, Uint8Array>;
  silhouettes: Record<BodyViewId, BodySilhouette>;
  bodyHeightCm: number;
  optics?: OpticalCalibrationProfile;
  diagnostics?: MultiViewStereoDiagnostics;
}): BodyMultiViewStereo | null {
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

  const views = Object.fromEntries(
    BODY_VIEW_SEQUENCE.map((view) => [
      view,
      {
        image: params.images[view],
        mask: params.masks[view],
        silhouette: params.silhouettes[view],
        luminance: buildLuminance(
          params.images[view],
        ),
        camera: usePerspective
          ? cameraCandidates[view]
          : undefined,
      },
    ]),
  ) as Record<BodyViewId, MvsView>;

  const depthMaps = Object.fromEntries(
    BODY_VIEW_SEQUENCE.map((view) => [
      view,
      createRawDepthMap({
        view,
        views,
        hull: params.hull,
        bodyHeightCm: params.bodyHeightCm,
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

  let validDepthCount = 0;
  let confidenceSum = 0;
  for (const view of BODY_VIEW_SEQUENCE) {
    const map = depthMaps[view];
    validDepthCount += map.validCount;
    confidenceSum +=
      map.meanConfidence * map.validCount;
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

  return {
    version: 1,
    method: "turntable-zncc-tsdf-v1",
    projectionModel: usePerspective
      ? "calibrated-turntable-perspective"
      : "metric-orthographic",
    meanCameraDistanceCm: usePerspective
      ? BODY_VIEW_SEQUENCE.reduce(
          (sum, view) =>
            sum +
            (cameraCandidates[view]?.distanceCm ?? 0),
          0,
        ) / BODY_VIEW_SEQUENCE.length
      : undefined,
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
