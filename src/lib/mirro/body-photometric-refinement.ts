import {
  BODY_VIEW_ANGLE_RAD,
  BODY_VIEW_SEQUENCE,
} from "./body-views";
import type { RgbaImage } from "./body-calibration";
import type {
  BodyMesh,
  BodySilhouette,
  BodyViewId,
  BodyVisualHull,
} from "./types";

type ViewData = {
  image: RgbaImage;
  mask: Uint8Array;
  silhouette: BodySilhouette;
  meanLuminance: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function wrapAngle(value: number) {
  let angle = value;
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
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

function meanBodyLuminance(image: RgbaImage, mask: Uint8Array) {
  let sum = 0;
  let count = 0;
  const stride = 4;

  for (let y = 0; y < image.height; y += stride) {
    for (let x = 0; x < image.width; x += stride) {
      const pixel = y * image.width + x;
      if (!mask[pixel]) continue;
      const offset = pixel * 4;
      sum +=
        image.data[offset] * 0.2126 +
        image.data[offset + 1] * 0.7152 +
        image.data[offset + 2] * 0.0722;
      count += 1;
    }
  }

  return count ? sum / count : 128;
}

function bilinearRgb(
  image: RgbaImage,
  x: number,
  y: number,
): [number, number, number] | null {
  if (
    x < 0 ||
    y < 0 ||
    x > image.width - 1 ||
    y > image.height - 1
  ) {
    return null;
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
    ] as const;
  };

  const a = sample(x0, y0);
  const b = sample(x1, y0);
  const c = sample(x0, y1);
  const d = sample(x1, y1);
  const out = [0, 0, 0];

  for (let channel = 0; channel < 3; channel += 1) {
    const top = a[channel] + (b[channel] - a[channel]) * tx;
    const bottom = c[channel] + (d[channel] - c[channel]) * tx;
    out[channel] = top + (bottom - top) * ty;
  }

  return out as [number, number, number];
}

function projectedPixel(
  view: BodyViewId,
  silhouette: BodySilhouette,
  bodyHeightCm: number,
  x: number,
  y: number,
  z: number,
) {
  const vertical = clamp(
    (bodyHeightCm / 2 - y) / Math.max(1, bodyHeightCm),
    0,
    1,
  );
  const rowWidthPx = Math.max(
    1,
    sampleProfile(silhouette.widthProfile, vertical) *
      silhouette.bounds.height,
  );
  const metricSpanCm = Math.max(
    1,
    sampleProfile(
      silhouette.metricWidthProfileCm,
      vertical,
    ) ||
      sampleProfile(silhouette.widthProfile, vertical) *
        bodyHeightCm,
  );
  const centerOffset =
    sampleProfile(silhouette.centerProfile, vertical) *
    silhouette.bounds.height;
  const centerX =
    silhouette.bounds.x +
    silhouette.bounds.width / 2 +
    centerOffset;
  const angle = BODY_VIEW_ANGLE_RAD[view];
  const horizontalCm =
    x * Math.cos(angle) - z * Math.sin(angle);

  return {
    x: centerX + (horizontalCm / metricSpanCm) * rowWidthPx,
    y:
      silhouette.bounds.y +
      vertical * Math.max(1, silhouette.bounds.height - 1),
  };
}

function feature(rgb: [number, number, number], meanLum: number) {
  const sum = rgb[0] + rgb[1] + rgb[2] + 3;
  const luminance =
    rgb[0] * 0.2126 +
    rgb[1] * 0.7152 +
    rgb[2] * 0.0722;

  return [
    rgb[0] / sum,
    rgb[1] / sum,
    Math.log((luminance + 1) / (meanLum + 1)) * 0.18,
  ] as const;
}

function candidateCost(params: {
  x: number;
  y: number;
  z: number;
  phi: number;
  bodyHeightCm: number;
  views: Partial<Record<BodyViewId, ViewData>>;
}) {
  const samples: Array<{
    feature: readonly [number, number, number];
    weight: number;
  }> = [];

  for (const view of BODY_VIEW_SEQUENCE) {
    const data = params.views[view];
    if (!data) continue;

    const delta = Math.abs(
      wrapAngle(params.phi - BODY_VIEW_ANGLE_RAD[view]),
    );
    const facing = Math.cos(delta);
    if (facing <= 0.25) continue;

    const pixel = projectedPixel(
      view,
      data.silhouette,
      params.bodyHeightCm,
      params.x,
      params.y,
      params.z,
    );
    const ix = Math.round(pixel.x);
    const iy = Math.round(pixel.y);
    if (
      ix < 0 ||
      iy < 0 ||
      ix >= data.image.width ||
      iy >= data.image.height ||
      !data.mask[iy * data.image.width + ix]
    ) {
      continue;
    }

    const rgb = bilinearRgb(data.image, pixel.x, pixel.y);
    if (!rgb) continue;
    samples.push({
      feature: feature(rgb, data.meanLuminance),
      weight:
        facing * facing *
        clamp(data.silhouette.confidence, 0.25, 1),
    });
  }

  if (samples.length < 3) return Infinity;

  const weightSum = samples.reduce(
    (sum, sample) => sum + sample.weight,
    0,
  );
  const mean = [0, 0, 0];
  for (const sample of samples) {
    for (let channel = 0; channel < 3; channel += 1) {
      mean[channel] +=
        sample.feature[channel] * sample.weight;
    }
  }
  for (let channel = 0; channel < 3; channel += 1) {
    mean[channel] /= Math.max(1e-6, weightSum);
  }

  let variance = 0;
  for (const sample of samples) {
    const dc0 = sample.feature[0] - mean[0];
    const dc1 = sample.feature[1] - mean[1];
    const dl = sample.feature[2] - mean[2];
    variance +=
      (dc0 * dc0 + dc1 * dc1 + dl * dl) *
      sample.weight;
  }

  return variance / Math.max(1e-6, weightSum);
}

function recomputeNormals(vertices: number[], indices: number[]) {
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

function torsoRange(mesh: BodyMesh) {
  const topRing =
    mesh.torsoTopRing ??
    mesh.landmarks.shoulderRing ??
    Math.floor(mesh.ringCount * 0.22);
  const bottomRing =
    mesh.torsoBottomRing ??
    mesh.landmarks.crotchRing ??
    Math.floor(mesh.ringCount * 0.68);
  const ringY = (ring: number) => {
    const t =
      clamp(ring, 0, mesh.ringCount - 1) /
      Math.max(1, mesh.ringCount - 1);
    return mesh.boundsCm.height / 2 - t * mesh.boundsCm.height;
  };
  return {
    top: ringY(topRing) + mesh.boundsCm.height * 0.025,
    bottom: ringY(bottomRing) - mesh.boundsCm.height * 0.025,
  };
}

export function refineVisualHullPhotometrically(params: {
  hull: BodyVisualHull;
  baseMesh: BodyMesh;
  images: Partial<Record<BodyViewId, RgbaImage>>;
  masks: Partial<Record<BodyViewId, Uint8Array>>;
  silhouettes: Partial<Record<BodyViewId, BodySilhouette>>;
  bodyHeightCm: number;
}): BodyVisualHull {
  if ((params.hull.viewCount ?? 4) < 8) return params.hull;

  const views = Object.fromEntries(
    BODY_VIEW_SEQUENCE.flatMap((view) => {
      const image = params.images[view];
      const mask = params.masks[view];
      const silhouette = params.silhouettes[view];
      if (!image || !mask || !silhouette) return [];
      return [
        [
          view,
          {
            image,
            mask,
            silhouette,
            meanLuminance: meanBodyLuminance(image, mask),
          },
        ],
      ];
    }),
  ) as Partial<Record<BodyViewId, ViewData>>;

  if (Object.keys(views).length < 8) return params.hull;

  const vertices = [...params.hull.vertices];
  const range = torsoRange(params.baseMesh);
  const voxel = params.hull.voxelSizeCm;
  const offsets = [
    0,
    voxel * 0.2,
    voxel * 0.4,
    voxel * 0.65,
    voxel * 0.9,
    Math.min(3.2, voxel * 1.25),
  ];
  let refinedVertexCount = 0;
  let offsetSum = 0;
  let improvementSum = 0;
  let maxInwardOffsetCm = 0;

  for (let offset = 0; offset < vertices.length; offset += 3) {
    const x = vertices[offset];
    const y = vertices[offset + 1];
    const z = vertices[offset + 2];
    if (y > range.top || y < range.bottom) continue;

    const radial = Math.hypot(x, z);
    if (radial < 3) continue;
    const nx = x / radial;
    const nz = z / radial;
    const phi = Math.atan2(x, z);

    const costs = offsets.map((inward) =>
      candidateCost({
        x: x - nx * inward,
        y,
        z: z - nz * inward,
        phi,
        bodyHeightCm: params.bodyHeightCm,
        views,
      }),
    );
    const baseline = costs[0];
    if (!Number.isFinite(baseline)) continue;

    let bestIndex = 0;
    let bestScore = baseline;
    for (let index = 1; index < costs.length; index += 1) {
      const prior = 0.000045 * offsets[index] * offsets[index];
      const score = costs[index] + prior;
      if (score < bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }

    const inward = offsets[bestIndex];
    if (inward <= 0) continue;
    const relativeImprovement =
      (baseline - bestScore) / Math.max(1e-8, baseline);
    if (relativeImprovement < 0.085) continue;

    const confidence = clamp(
      (relativeImprovement - 0.085) / 0.22,
      0.35,
      0.9,
    );
    const acceptedOffset = inward * confidence;
    vertices[offset] = x - nx * acceptedOffset;
    vertices[offset + 2] = z - nz * acceptedOffset;
    refinedVertexCount += 1;
    offsetSum += acceptedOffset;
    improvementSum += relativeImprovement;
    maxInwardOffsetCm = Math.max(
      maxInwardOffsetCm,
      acceptedOffset,
    );
  }

  if (!refinedVertexCount) {
    return {
      ...params.hull,
      photometricRefinement: {
        version: 1,
        method: "turntable-plane-sweep-photoconsistency-v1",
        refinedVertexCount: 0,
        meanInwardOffsetCm: 0,
        maxInwardOffsetCm: 0,
        meanRelativeImprovement: 0,
      },
    };
  }

  return {
    ...params.hull,
    vertices,
    normals: recomputeNormals(vertices, params.hull.indices),
    photometricRefinement: {
      version: 1,
      method: "turntable-plane-sweep-photoconsistency-v1",
      refinedVertexCount,
      meanInwardOffsetCm: offsetSum / refinedVertexCount,
      maxInwardOffsetCm,
      meanRelativeImprovement:
        improvementSum / refinedVertexCount,
    },
  };
}
