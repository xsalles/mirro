import type { GarmentCalibration, GarmentSilhouette } from "./types";

export type AlphaImage = {
  width: number;
  height: number;
  alpha: Uint8Array;
};

const DEFAULT_SAMPLES = 48;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function smooth(values: number[], radius = 2) {
  return values.map((_, index) => {
    let total = 0;
    let count = 0;
    for (let offset = -radius; offset <= radius; offset += 1) {
      const at = index + offset;
      if (at < 0 || at >= values.length) continue;
      total += values[at];
      count += 1;
    }
    return count ? total / count : values[index];
  });
}

function fillGaps(values: number[]) {
  const next = [...values];

  for (let index = 0; index < next.length; index += 1) {
    if (next[index] > 0) continue;

    let left = index - 1;
    let right = index + 1;
    while (left >= 0 && next[left] === 0) left -= 1;
    while (right < next.length && next[right] === 0) right += 1;

    if (left >= 0 && right < next.length) next[index] = (next[left] + next[right]) / 2;
    else if (left >= 0) next[index] = next[left];
    else if (right < next.length) next[index] = next[right];
  }

  return next;
}

export function analyzeAlphaSilhouette(
  image: AlphaImage,
  sampleCount = DEFAULT_SAMPLES,
): GarmentSilhouette {
  if (image.width < 16 || image.height < 16) {
    throw new Error("A imagem da peça tem resolução insuficiente.");
  }

  const threshold = 48;
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;
  let foreground = 0;

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (image.alpha[y * image.width + x] < threshold) continue;
      foreground += 1;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < minX || maxY < minY || foreground < image.width * image.height * 0.01) {
    throw new Error("Não foi possível encontrar a silhueta da peça.");
  }

  const bounds = {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
  const widthProfile = new Array<number>(sampleCount).fill(0);
  const centerProfile = new Array<number>(sampleCount).fill(0);
  const boundsCenter = bounds.x + bounds.width / 2;

  for (let sample = 0; sample < sampleCount; sample += 1) {
    const t = sampleCount === 1 ? 0 : sample / (sampleCount - 1);
    const centerY = bounds.y + Math.round(t * (bounds.height - 1));
    let rowMin = image.width;
    let rowMax = -1;
    let weightedCenter = 0;
    let rows = 0;

    for (let dy = -1; dy <= 1; dy += 1) {
      const y = centerY + dy;
      if (y < bounds.y || y >= bounds.y + bounds.height) continue;

      let localMin = image.width;
      let localMax = -1;
      for (let x = bounds.x; x < bounds.x + bounds.width; x += 1) {
        if (image.alpha[y * image.width + x] < threshold) continue;
        localMin = Math.min(localMin, x);
        localMax = Math.max(localMax, x);
      }

      if (localMax >= localMin) {
        rowMin = Math.min(rowMin, localMin);
        rowMax = Math.max(rowMax, localMax);
        weightedCenter += (localMin + localMax) / 2;
        rows += 1;
      }
    }

    if (rowMax >= rowMin && rows > 0) {
      widthProfile[sample] = (rowMax - rowMin + 1) / bounds.width;
      centerProfile[sample] = ((weightedCenter / rows) - boundsCenter) / bounds.width;
    }
  }

  return {
    sourceWidth: image.width,
    sourceHeight: image.height,
    bounds,
    widthProfile: smooth(fillGaps(widthProfile), 2),
    centerProfile: smooth(centerProfile, 2),
    occupancyRatio: foreground / Math.max(1, bounds.width * bounds.height),
  };
}

function meanAbsoluteDifference(a: number[], b: number[]) {
  const count = Math.min(a.length, b.length);
  if (!count) return 1;
  let total = 0;
  for (let i = 0; i < count; i += 1) total += Math.abs(a[i] - b[i]);
  return total / count;
}

export function buildGarmentCalibration(
  front: GarmentSilhouette,
  back: GarmentSilhouette,
): GarmentCalibration {
  if (front.widthProfile.length !== back.widthProfile.length) {
    throw new Error("Frente e costas da peça precisam usar a mesma resolução de perfil.");
  }

  const frontBackDifference = meanAbsoluteDifference(front.widthProfile, back.widthProfile);
  const occupancyDifference = Math.abs(front.occupancyRatio - back.occupancyRatio);
  const score = clamp(1 - frontBackDifference * 1.7 - occupancyDifference * 0.7, 0, 1);
  const warnings: string[] = [];

  if (frontBackDifference > 0.16) {
    warnings.push("Frente e costas parecem ter enquadramentos ou dobras diferentes.");
  }
  if (Math.min(front.occupancyRatio, back.occupancyRatio) < 0.22) {
    warnings.push("A peça ocupa pouca área útil da foto; aproxime a câmera ou recorte melhor.");
  }
  if (score < 0.58) {
    warnings.push("Refaça as fotos da peça mais esticada e com o mesmo enquadramento.");
  }

  return {
    version: 1,
    method: "alpha-profile-v1",
    sampleCount: front.widthProfile.length,
    front,
    back,
    quality: {
      score,
      frontBackDifference,
      warnings,
    },
    createdAt: new Date().toISOString(),
  };
}
