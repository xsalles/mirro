import type {
  BodySide,
  BodySilhouette,
  BodyTextureCalibration,
} from "./types";
import type { RgbaImage } from "./body-calibration";

const SIDES: BodySide[] = ["front", "right", "back", "left"];

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function sampleBodyColor(
  image: RgbaImage,
  mask: Uint8Array,
  silhouette: BodySilhouette,
) {
  const stride = Math.max(
    1,
    Math.round(Math.min(image.width, image.height) / 180),
  );
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;

  const minY = silhouette.bounds.y + silhouette.bounds.height * 0.12;
  const maxY = silhouette.bounds.y + silhouette.bounds.height * 0.88;
  const minX = silhouette.bounds.x;
  const maxX = silhouette.bounds.x + silhouette.bounds.width;

  for (let y = Math.floor(minY); y < maxY; y += stride) {
    for (let x = minX; x < maxX; x += stride) {
      const pixel = y * image.width + x;
      if (!mask[pixel]) continue;
      const offset = pixel * 4;
      const rr = image.data[offset];
      const gg = image.data[offset + 1];
      const bb = image.data[offset + 2];

      const luminance = 0.2126 * rr + 0.7152 * gg + 0.0722 * bb;
      if (luminance < 10 || luminance > 248) continue;

      r += rr;
      g += gg;
      b += bb;
      count += 1;
    }
  }

  if (!count) {
    return { rgb: [128, 128, 128] as [number, number, number], luminance: 128 };
  }

  const rgb: [number, number, number] = [
    r / count,
    g / count,
    b / count,
  ];
  return {
    rgb,
    luminance:
      0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2],
  };
}

export function analyzeBodyTextureCalibration(params: {
  images: Record<BodySide, RgbaImage>;
  masks: Record<BodySide, Uint8Array>;
  silhouettes: Record<BodySide, BodySilhouette>;
}): BodyTextureCalibration {
  const samples = {} as Record<
    BodySide,
    { rgb: [number, number, number]; luminance: number }
  >;

  for (const side of SIDES) {
    samples[side] = sampleBodyColor(
      params.images[side],
      params.masks[side],
      params.silhouettes[side],
    );
  }

  const referenceRgb: [number, number, number] = [
    median(SIDES.map((side) => samples[side].rgb[0])),
    median(SIDES.map((side) => samples[side].rgb[1])),
    median(SIDES.map((side) => samples[side].rgb[2])),
  ];
  const referenceLuminance = median(
    SIDES.map((side) => samples[side].luminance),
  );

  const gains = {} as Record<BodySide, [number, number, number]>;
  const meanLuminance = {} as Record<BodySide, number>;
  let residual = 0;

  for (const side of SIDES) {
    const sample = samples[side];
    meanLuminance[side] = sample.luminance;

    const exposureGain = clamp(
      referenceLuminance / Math.max(1, sample.luminance),
      0.72,
      1.38,
    );
    const channelGains = referenceRgb.map((target, index) =>
      clamp(
        Math.sqrt(
          exposureGain *
            (target / Math.max(1, sample.rgb[index])),
        ),
        0.78,
        1.28,
      ),
    ) as [number, number, number];

    gains[side] = channelGains;

    const balanced = sample.rgb.map(
      (value, index) => value * channelGains[index],
    );
    const balancedLum =
      0.2126 * balanced[0] +
      0.7152 * balanced[1] +
      0.0722 * balanced[2];
    residual +=
      Math.abs(balancedLum - referenceLuminance) /
      Math.max(1, referenceLuminance);
  }

  const score = clamp(1 - residual / SIDES.length, 0, 1);

  return {
    version: 1,
    method: "log-luminance-rgb-gain-v1",
    gains,
    meanLuminance,
    score,
  };
}
