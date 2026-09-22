"use client";

import type {
  BodySide,
  BodySilhouette,
  BodyTextureCalibration,
} from "./types";

type SourceImage = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
};

const SIDES: BodySide[] = ["front", "right", "back", "left"];
const SIDE_ANGLE: Record<BodySide, number> = {
  front: 0,
  right: Math.PI / 2,
  back: Math.PI,
  left: -Math.PI / 2,
};

function wrapAngle(value: number) {
  let angle = value;
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function sampleProfile(profile: number[], t: number) {
  if (!profile.length) return 0;
  const position = clamp(t, 0, 1) * (profile.length - 1);
  const low = Math.floor(position);
  const high = Math.min(profile.length - 1, low + 1);
  const mix = position - low;
  return (
    (profile[low] ?? 0) +
    ((profile[high] ?? profile[low] ?? 0) - (profile[low] ?? 0)) *
      mix
  );
}

async function loadImage(url: string): Promise<SourceImage> {
  const image = new Image();
  image.decoding = "async";
  image.src = url;
  await image.decode();

  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas 2D indisponível para textura corporal.");

  context.drawImage(image, 0, 0);
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
  return { width: canvas.width, height: canvas.height, data };
}

function bilinearSample(
  source: SourceImage,
  x: number,
  y: number,
): [number, number, number, number] {
  const x0 = clamp(Math.floor(x), 0, source.width - 1);
  const y0 = clamp(Math.floor(y), 0, source.height - 1);
  const x1 = Math.min(source.width - 1, x0 + 1);
  const y1 = Math.min(source.height - 1, y0 + 1);
  const tx = clamp(x - x0, 0, 1);
  const ty = clamp(y - y0, 0, 1);

  const read = (px: number, py: number) => {
    const offset = (py * source.width + px) * 4;
    return [
      source.data[offset],
      source.data[offset + 1],
      source.data[offset + 2],
      source.data[offset + 3],
    ] as const;
  };

  const a = read(x0, y0);
  const b = read(x1, y0);
  const c = read(x0, y1);
  const d = read(x1, y1);

  const out = [0, 0, 0, 0];
  for (let channel = 0; channel < 4; channel += 1) {
    const top = a[channel] + (b[channel] - a[channel]) * tx;
    const bottom = c[channel] + (d[channel] - c[channel]) * tx;
    out[channel] = top + (bottom - top) * ty;
  }
  return out as [number, number, number, number];
}

function sourcePoint(
  silhouette: BodySilhouette,
  side: BodySide,
  angle: number,
  v: number,
) {
  const delta = wrapAngle(angle - SIDE_ANGLE[side]);
  const clampedDelta = clamp(delta, -Math.PI / 2, Math.PI / 2);
  const horizontal = 0.5 + Math.sin(clampedDelta) * 0.5;
  const rowWidth = Math.max(
    1,
    sampleProfile(silhouette.widthProfile, v) * silhouette.bounds.height,
  );
  const centerX = silhouette.bounds.x + silhouette.bounds.width / 2;

  return {
    x: centerX + (horizontal - 0.5) * rowWidth,
    y:
      silhouette.bounds.y +
      v * Math.max(1, silhouette.bounds.height - 1),
  };
}

function sampleGridGain(
  calibration: BodyTextureCalibration | undefined,
  side: BodySide,
  horizontal: number,
  vertical: number,
): [number, number, number] {
  const fallback = calibration?.gains[side] ?? [1, 1, 1];
  const grid = calibration?.grid;
  if (!grid) return fallback;

  const gx = clamp(horizontal, 0, 1) * Math.max(0, grid.columns - 1);
  const gy = clamp(vertical, 0, 1) * Math.max(0, grid.rows - 1);
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const x1 = Math.min(grid.columns - 1, x0 + 1);
  const y1 = Math.min(grid.rows - 1, y0 + 1);
  const tx = gx - x0;
  const ty = gy - y0;
  const at = (x: number, y: number) =>
    grid.gains[side][y * grid.columns + x] ?? fallback;
  const a = at(x0, y0);
  const b = at(x1, y0);
  const cc = at(x0, y1);
  const d = at(x1, y1);
  return [0, 1, 2].map((channel) => {
    const top = a[channel] + (b[channel] - a[channel]) * tx;
    const bottom = cc[channel] + (d[channel] - cc[channel]) * tx;
    return top + (bottom - top) * ty;
  }) as [number, number, number];
}

function angularWeight(side: BodySide, angle: number, confidence: number) {
  const delta = Math.abs(wrapAngle(angle - SIDE_ANGLE[side]));
  const coverage = (72 * Math.PI) / 180;
  if (delta >= coverage) return 0;
  const normalized = delta / coverage;
  const feather = Math.cos(normalized * Math.PI * 0.5) ** 2;
  return feather * feather * clamp(confidence, 0.2, 1);
}

export async function buildBodyTextureAtlas(params: {
  urls: Partial<Record<BodySide, string | null>>;
  silhouettes: Record<BodySide, BodySilhouette>;
  textureCalibration?: BodyTextureCalibration;
  width?: number;
  height?: number;
}) {
  const width = params.width ?? 1024;
  const height = params.height ?? 768;
  const loadedEntries = await Promise.all(
    SIDES.map(async (side) => {
      const url = params.urls[side];
      if (!url) return [side, null] as const;
      return [side, await loadImage(url)] as const;
    }),
  );
  const sources = Object.fromEntries(loadedEntries) as Partial<
    Record<BodySide, SourceImage | null>
  >;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D indisponível para atlas corporal.");

  const output = context.createImageData(width, height);

  for (let y = 0; y < height; y += 1) {
    const v = y / Math.max(1, height - 1);

    for (let x = 0; x < width; x += 1) {
      const u = x / Math.max(1, width - 1);
      const angle = (u - 0.5) * Math.PI * 2;
      let totalWeight = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      let alpha = 0;

      for (const side of SIDES) {
        const source = sources[side];
        if (!source) continue;
        const silhouette = params.silhouettes[side];
        const weight = angularWeight(side, angle, silhouette.confidence);
        if (weight <= 0) continue;

        const point = sourcePoint(silhouette, side, angle, v);
        const sampled = bilinearSample(source, point.x, point.y);
        const localHorizontal = clamp(
          (point.x - silhouette.bounds.x) /
            Math.max(1, silhouette.bounds.width),
          0,
          1,
        );
        const gain = sampleGridGain(
          params.textureCalibration,
          side,
          localHorizontal,
          v,
        );

        r += sampled[0] * gain[0] * weight;
        g += sampled[1] * gain[1] * weight;
        b += sampled[2] * gain[2] * weight;
        alpha += sampled[3] * weight;
        totalWeight += weight;
      }

      const offset = (y * width + x) * 4;
      if (totalWeight > 1e-5) {
        output.data[offset] = clamp(Math.round(r / totalWeight), 0, 255);
        output.data[offset + 1] = clamp(Math.round(g / totalWeight), 0, 255);
        output.data[offset + 2] = clamp(Math.round(b / totalWeight), 0, 255);
        output.data[offset + 3] = clamp(
          Math.round(alpha / totalWeight),
          0,
          255,
        );
      }
    }
  }

  context.putImageData(output, 0, 0);
  return canvas;
}

export function bodyAtlasUvs(vertices: number[], heightCm: number) {
  const uv = new Array<number>((vertices.length / 3) * 2);
  const halfHeight = heightCm / 2;

  for (let vertex = 0; vertex < vertices.length / 3; vertex += 1) {
    const offset = vertex * 3;
    const x = vertices[offset];
    const y = vertices[offset + 1];
    const z = vertices[offset + 2];
    const angle = Math.atan2(x, z);
    const u = ((angle / (Math.PI * 2) + 0.5) % 1 + 1) % 1;
    const v = clamp(
      (halfHeight - y) / Math.max(1, heightCm),
      0,
      1,
    );

    uv[vertex * 2] = u;
    uv[vertex * 2 + 1] = v;
  }

  return uv;
}
