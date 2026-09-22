import type {
  BodySide,
  BodySilhouette,
  BodyTextureCalibration,
} from "./types";
import type { RgbaImage } from "./body-calibration";

const SIDES: BodySide[] = ["front", "right", "back", "left"];
const GRID_COLUMNS = 3;
const GRID_ROWS = 8;

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
  cell?: { column: number; row: number },
) {
  const stride = Math.max(
    1,
    Math.round(Math.min(image.width, image.height) / 220),
  );
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;

  const horizontalStart = cell ? cell.column / GRID_COLUMNS : 0;
  const horizontalEnd = cell ? (cell.column + 1) / GRID_COLUMNS : 1;
  const verticalStart = cell ? cell.row / GRID_ROWS : 0.1;
  const verticalEnd = cell ? (cell.row + 1) / GRID_ROWS : 0.9;
  const minX =
    silhouette.bounds.x + silhouette.bounds.width * horizontalStart;
  const maxX =
    silhouette.bounds.x + silhouette.bounds.width * horizontalEnd;
  const minY =
    silhouette.bounds.y + silhouette.bounds.height * verticalStart;
  const maxY =
    silhouette.bounds.y + silhouette.bounds.height * verticalEnd;

  for (let y = Math.floor(minY); y < maxY; y += stride) {
    for (let x = Math.floor(minX); x < maxX; x += stride) {
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
    return {
      rgb: [128, 128, 128] as [number, number, number],
      luminance: 128,
      count: 0,
    };
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
    count,
  };
}

function channelGain(
  current: number,
  target: number,
  exposureGain: number,
  min: number,
  max: number,
) {
  return clamp(
    Math.sqrt(
      exposureGain * (target / Math.max(1, current)),
    ),
    min,
    max,
  );
}

export function analyzeBodyTextureCalibration(params: {
  images: Record<BodySide, RgbaImage>;
  masks: Record<BodySide, Uint8Array>;
  silhouettes: Record<BodySide, BodySilhouette>;
}): BodyTextureCalibration {
  const samples = {} as Record<
    BodySide,
    ReturnType<typeof sampleBodyColor>
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

  for (const side of SIDES) {
    const sample = samples[side];
    meanLuminance[side] = sample.luminance;
    const exposureGain = clamp(
      referenceLuminance / Math.max(1, sample.luminance),
      0.72,
      1.38,
    );
    gains[side] = referenceRgb.map((target, index) =>
      channelGain(
        sample.rgb[index],
        target,
        exposureGain,
        0.78,
        1.28,
      ),
    ) as [number, number, number];
  }

  const localSamples = Object.fromEntries(
    SIDES.map((side) => [
      side,
      Array.from(
        { length: GRID_COLUMNS * GRID_ROWS },
        (_, index) =>
          sampleBodyColor(
            params.images[side],
            params.masks[side],
            params.silhouettes[side],
            {
              column: index % GRID_COLUMNS,
              row: Math.floor(index / GRID_COLUMNS),
            },
          ),
      ),
    ]),
  ) as Record<BodySide, Array<ReturnType<typeof sampleBodyColor>>>;

  const gridGains = {} as Record<
    BodySide,
    Array<[number, number, number]>
  >;
  let residual = 0;
  let residualCount = 0;

  for (const side of SIDES) gridGains[side] = [];

  for (let cell = 0; cell < GRID_COLUMNS * GRID_ROWS; cell += 1) {
    const validSides = SIDES.filter(
      (side) => localSamples[side][cell].count > 2,
    );
    const referenceCellRgb: [number, number, number] = [
      median(
        validSides.map((side) => localSamples[side][cell].rgb[0]),
      ) || referenceRgb[0],
      median(
        validSides.map((side) => localSamples[side][cell].rgb[1]),
      ) || referenceRgb[1],
      median(
        validSides.map((side) => localSamples[side][cell].rgb[2]),
      ) || referenceRgb[2],
    ];
    const referenceCellLuminance =
      median(
        validSides.map(
          (side) => localSamples[side][cell].luminance,
        ),
      ) || referenceLuminance;

    for (const side of SIDES) {
      const sample = localSamples[side][cell];
      const global = gains[side];

      if (sample.count <= 2) {
        gridGains[side].push(global);
        continue;
      }

      const localExposure = clamp(
        referenceCellLuminance / Math.max(1, sample.luminance),
        0.82,
        1.22,
      );
      const local = referenceCellRgb.map((target, channel) =>
        channelGain(
          sample.rgb[channel],
          target,
          localExposure,
          global[channel] * 0.88,
          global[channel] * 1.12,
        ),
      ) as [number, number, number];
      const blended = local.map(
        (value, channel) =>
          global[channel] * 0.35 + value * 0.65,
      ) as [number, number, number];

      gridGains[side].push(blended);

      const balanced = sample.rgb.map(
        (value, channel) => value * blended[channel],
      );
      const balancedLum =
        0.2126 * balanced[0] +
        0.7152 * balanced[1] +
        0.0722 * balanced[2];
      residual +=
        Math.abs(balancedLum - referenceCellLuminance) /
        Math.max(1, referenceCellLuminance);
      residualCount += 1;
    }
  }

  const score = clamp(
    1 - residual / Math.max(1, residualCount),
    0,
    1,
  );

  return {
    version: 2,
    method: "local-grid-rgb-transfer-v2",
    gains,
    meanLuminance,
    grid: {
      columns: GRID_COLUMNS,
      rows: GRID_ROWS,
      gains: gridGains,
    },
    score,
  };
}
