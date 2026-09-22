import type {
  BodySilhouette,
  BodyViewCalibration,
} from "./types";
import type { RgbaImage } from "./body-calibration";

type MarkerName = "magenta" | "cyan" | "yellow" | "blue";
type Point = [number, number];

const TARGET_CENTER_SPAN_CM = {
  horizontal: 15.8,
  vertical: 24.5,
} as const;

const REFERENCES: Record<MarkerName, [number, number, number]> = {
  magenta: [214, 0, 143],
  cyan: [0, 166, 214],
  yellow: [246, 200, 0],
  blue: [64, 84, 255],
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizedRgb(r: number, g: number, b: number) {
  const sum = Math.max(1, r + g + b);
  return [r / sum, g / sum, b / sum] as const;
}

const NORMALIZED_REFERENCES = Object.fromEntries(
  Object.entries(REFERENCES).map(([name, rgb]) => [
    name,
    normalizedRgb(rgb[0], rgb[1], rgb[2]),
  ]),
) as Record<MarkerName, readonly [number, number, number]>;

function markerDistance(
  r: number,
  g: number,
  b: number,
  marker: MarkerName,
) {
  const current = normalizedRgb(r, g, b);
  const target = NORMALIZED_REFERENCES[marker];
  return Math.hypot(
    current[0] - target[0],
    current[1] - target[1],
    current[2] - target[2],
  );
}

function detectMarker(image: RgbaImage, marker: MarkerName) {
  const { width, height, data } = image;
  const mask = new Uint8Array(width * height);
  const threshold = marker === "yellow" ? 0.115 : 0.105;

  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const offset = pixel * 4;
    const alpha = data[offset + 3];
    if (alpha < 96) continue;

    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max - min < 38) continue;

    if (markerDistance(r, g, b, marker) <= threshold) {
      mask[pixel] = 1;
    }
  }

  const labels = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let best:
    | {
        area: number;
        center: Point;
        bounds: { x: number; y: number; width: number; height: number };
      }
    | undefined;

  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || labels[start]) continue;

    let head = 0;
    let tail = 0;
    let area = 0;
    let sumX = 0;
    let sumY = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;

    labels[start] = 1;
    queue[tail++] = start;

    while (head < tail) {
      const current = queue[head++];
      const x = current % width;
      const y = Math.floor(current / width);
      area += 1;
      sumX += x;
      sumY += y;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);

      const neighbors = [
        x > 0 ? current - 1 : -1,
        x + 1 < width ? current + 1 : -1,
        y > 0 ? current - width : -1,
        y + 1 < height ? current + width : -1,
      ];
      for (const next of neighbors) {
        if (next < 0 || !mask[next] || labels[next]) continue;
        labels[next] = 1;
        queue[tail++] = next;
      }
    }

    if (area < Math.max(8, width * height * 0.000015)) continue;
    const boxWidth = maxX - minX + 1;
    const boxHeight = maxY - minY + 1;
    const aspect = boxWidth / Math.max(1, boxHeight);
    const fill = area / Math.max(1, boxWidth * boxHeight);
    if (aspect < 0.48 || aspect > 2.05 || fill < 0.32) continue;

    if (!best || area > best.area) {
      best = {
        area,
        center: [sumX / area, sumY / area],
        bounds: {
          x: minX,
          y: minY,
          width: boxWidth,
          height: boxHeight,
        },
      };
    }
  }

  return best;
}

function distance(a: Point, b: Point) {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

function lineAngle(a: Point, b: Point) {
  return Math.atan2(b[1] - a[1], b[0] - a[0]);
}

export function detectBodyViewCalibration(
  image: RgbaImage,
): BodyViewCalibration | null {
  const detected = {
    magenta: detectMarker(image, "magenta"),
    cyan: detectMarker(image, "cyan"),
    yellow: detectMarker(image, "yellow"),
    blue: detectMarker(image, "blue"),
  };

  if (
    !detected.magenta ||
    !detected.cyan ||
    !detected.yellow ||
    !detected.blue
  ) {
    return null;
  }

  const magenta = detected.magenta.center;
  const cyan = detected.cyan.center;
  const yellow = detected.yellow.center;
  const blue = detected.blue.center;

  const top = distance(magenta, cyan);
  const bottom = distance(yellow, blue);
  const left = distance(magenta, yellow);
  const right = distance(cyan, blue);

  const horizontalPxPerCm =
    ((top + bottom) / 2) / TARGET_CENTER_SPAN_CM.horizontal;
  const verticalPxPerCm =
    ((left + right) / 2) / TARGET_CENTER_SPAN_CM.vertical;
  const pixelsPerCm = (horizontalPxPerCm + verticalPxPerCm) / 2;

  if (!Number.isFinite(pixelsPerCm) || pixelsPerCm < 0.8) return null;

  const rollRadians =
    (lineAngle(magenta, cyan) + lineAngle(yellow, blue)) / 2;
  const horizontalSkew =
    Math.abs(top - bottom) / Math.max(1, (top + bottom) / 2);
  const verticalSkew =
    Math.abs(left - right) / Math.max(1, (left + right) / 2);
  const orthogonality =
    Math.abs(
      Math.cos(
        lineAngle(magenta, cyan) - lineAngle(magenta, yellow),
      ),
    );
  const perspectiveSkew = clamp(
    horizontalSkew * 0.42 + verticalSkew * 0.42 + orthogonality * 0.16,
    0,
    1,
  );

  const xs = [magenta[0], cyan[0], yellow[0], blue[0]];
  const ys = [magenta[1], cyan[1], yellow[1], blue[1]];
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const scaleAgreement =
    1 -
    clamp(
      Math.abs(horizontalPxPerCm - verticalPxPerCm) /
        Math.max(0.01, pixelsPerCm),
      0,
      1,
    );
  const score = clamp(
    scaleAgreement * 0.62 + (1 - perspectiveSkew) * 0.38,
    0,
    1,
  );

  return {
    method: "mirro-a4-color-target-v1",
    pixelsPerCm,
    rollRadians,
    perspectiveSkew,
    score,
    targetBounds: {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    },
    markerCenters: {
      magenta,
      cyan,
      yellow,
      blue,
    },
  };
}

export function applyMetricViewCalibration(
  silhouette: BodySilhouette,
  calibration: BodyViewCalibration | null,
): BodySilhouette {
  if (!calibration) return silhouette;

  const bodyHeightPx = silhouette.bounds.height;
  const metricWidthProfileCm = silhouette.widthProfile.map(
    (normalizedWidth) =>
      (normalizedWidth * bodyHeightPx) / calibration.pixelsPerCm,
  );

  return {
    ...silhouette,
    metricWidthProfileCm,
    metricBodyHeightCm: bodyHeightPx / calibration.pixelsPerCm,
    viewCalibration: calibration,
  };
}
