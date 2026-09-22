"use client";

import { undistortRgbaImage } from "./lens-distortion";
import { scaleOpticalIntrinsics } from "./optical-calibration";
import type {
  BodyCameraRig,
  BodySide,
  BodySilhouette,
  BodyTextureCalibration,
  OpticalCalibrationProfile,
} from "./types";

type SourceImage = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
};

type SourcePyramid = {
  original: SourceImage;
  blur2: SourceImage;
  blur8: SourceImage;
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

function sampleProfile(profile: number[] | undefined, t: number) {
  if (!profile?.length) return 0;
  const position = clamp(t, 0, 1) * (profile.length - 1);
  const low = Math.floor(position);
  const high = Math.min(profile.length - 1, low + 1);
  const mix = position - low;
  return (
    (profile[low] ?? 0) +
    ((profile[high] ?? profile[low] ?? 0) -
      (profile[low] ?? 0)) *
      mix
  );
}

async function loadImage(
  url: string,
  targetWidth: number,
  targetHeight: number,
): Promise<SourceImage> {
  const image = new Image();
  image.decoding = "async";
  image.src = url;
  await image.decode();

  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext("2d", {
    willReadFrequently: true,
  });
  if (!context) {
    throw new Error(
      "Canvas 2D indisponível para textura corporal.",
    );
  }

  context.drawImage(
    image,
    0,
    0,
    targetWidth,
    targetHeight,
  );
  const data = context.getImageData(
    0,
    0,
    canvas.width,
    canvas.height,
  ).data;
  return {
    width: canvas.width,
    height: canvas.height,
    data,
  };
}

function boxBlur(source: SourceImage, radius: number): SourceImage {
  if (radius <= 0) return source;
  const { width, height } = source;
  const horizontal = new Float64Array(source.data.length);
  const output = new Uint8ClampedArray(source.data.length);
  const windowSize = radius * 2 + 1;

  for (let y = 0; y < height; y += 1) {
    const sums = [0, 0, 0, 0];
    for (let x = -radius; x <= radius; x += 1) {
      const px = clamp(x, 0, width - 1);
      const offset = (y * width + px) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        sums[channel] += source.data[offset + channel];
      }
    }

    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        horizontal[offset + channel] =
          sums[channel] / windowSize;
      }

      const removeX = clamp(x - radius, 0, width - 1);
      const addX = clamp(x + radius + 1, 0, width - 1);
      const removeOffset = (y * width + removeX) * 4;
      const addOffset = (y * width + addX) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        sums[channel] +=
          source.data[addOffset + channel] -
          source.data[removeOffset + channel];
      }
    }
  }

  for (let x = 0; x < width; x += 1) {
    const sums = [0, 0, 0, 0];
    for (let y = -radius; y <= radius; y += 1) {
      const py = clamp(y, 0, height - 1);
      const offset = (py * width + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        sums[channel] += horizontal[offset + channel];
      }
    }

    for (let y = 0; y < height; y += 1) {
      const offset = (y * width + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        output[offset + channel] = clamp(
          Math.round(sums[channel] / windowSize),
          0,
          255,
        );
      }

      const removeY = clamp(y - radius, 0, height - 1);
      const addY = clamp(y + radius + 1, 0, height - 1);
      const removeOffset = (removeY * width + x) * 4;
      const addOffset = (addY * width + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        sums[channel] +=
          horizontal[addOffset + channel] -
          horizontal[removeOffset + channel];
      }
    }
  }

  return { width, height, data: output };
}

function buildPyramid(source: SourceImage): SourcePyramid {
  return {
    original: source,
    blur2: boxBlur(source, 2),
    blur8: boxBlur(source, 8),
  };
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
    const top =
      a[channel] + (b[channel] - a[channel]) * tx;
    const bottom =
      c[channel] + (d[channel] - c[channel]) * tx;
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
  const clampedDelta = clamp(
    delta,
    -Math.PI / 2,
    Math.PI / 2,
  );
  const horizontal = 0.5 + Math.sin(clampedDelta) * 0.5;
  const rowWidth = Math.max(
    1,
    sampleProfile(silhouette.widthProfile, v) *
      silhouette.bounds.height,
  );
  const centerOffset =
    sampleProfile(silhouette.centerProfile, v) *
    silhouette.bounds.height;
  const centerX =
    silhouette.bounds.x +
    silhouette.bounds.width / 2 +
    centerOffset;

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

  const gx =
    clamp(horizontal, 0, 1) * Math.max(0, grid.columns - 1);
  const gy =
    clamp(vertical, 0, 1) * Math.max(0, grid.rows - 1);
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
  const c = at(x0, y1);
  const d = at(x1, y1);

  return [0, 1, 2].map((channel) => {
    const top =
      a[channel] + (b[channel] - a[channel]) * tx;
    const bottom =
      c[channel] + (d[channel] - c[channel]) * tx;
    return top + (bottom - top) * ty;
  }) as [number, number, number];
}

function angularWeight(
  side: BodySide,
  angle: number,
  confidence: number,
  coverageDegrees: number,
  power: number,
) {
  const delta = Math.abs(
    wrapAngle(angle - SIDE_ANGLE[side]),
  );
  const coverage = (coverageDegrees * Math.PI) / 180;
  if (delta >= coverage) return 0;
  const normalized = delta / coverage;
  const feather = Math.cos(
    normalized * Math.PI * 0.5,
  );
  return (
    Math.max(0, feather) ** power *
    clamp(confidence, 0.2, 1)
  );
}

function opticsForSource(
  source: SourceImage,
  optics: OpticalCalibrationProfile,
) {
  const sourceAspect = source.width / Math.max(1, source.height);
  const opticsAspect =
    optics.imageWidth / Math.max(1, optics.imageHeight);
  if (
    Math.abs(
      sourceAspect / Math.max(1e-6, opticsAspect) - 1,
    ) > 0.025
  ) {
    return null;
  }

  return scaleOpticalIntrinsics(
    optics.intrinsics,
    {
      width: optics.imageWidth,
      height: optics.imageHeight,
    },
    {
      width: source.width,
      height: source.height,
    },
  );
}

function dilateSeamMask(
  mask: Uint8Array,
  width: number,
  height: number,
  radius = 3,
) {
  const output = new Uint8Array(mask);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (!mask[index]) continue;
      for (let dy = -1; dy <= 1; dy += 1) {
        const py = y + dy;
        if (py < 0 || py >= height) continue;
        for (let dx = -radius; dx <= radius; dx += 1) {
          const px = (x + dx + width) % width;
          output[py * width + px] = 1;
        }
      }
    }
  }
  return output;
}

export function optimizeGradientDomainSeams(params: {
  base: Uint8ClampedArray;
  guidance: Uint8ClampedArray;
  seamMask: Uint8Array;
  width: number;
  height: number;
  iterations?: number;
  screening?: number;
}) {
  const {
    base,
    guidance,
    width,
    height,
  } = params;
  if (
    base.length !== width * height * 4 ||
    guidance.length !== base.length ||
    params.seamMask.length !== width * height
  ) {
    throw new Error(
      "Atlas, guidance e seam mask precisam compartilhar as mesmas dimensões.",
    );
  }

  const seamMask = dilateSeamMask(
    params.seamMask,
    width,
    height,
    3,
  );
  const seamIndices: number[] = [];
  for (let index = 0; index < seamMask.length; index += 1) {
    if (
      seamMask[index] &&
      base[index * 4 + 3] > 0
    ) {
      seamIndices.push(index);
    }
  }
  if (!seamIndices.length) return new Uint8ClampedArray(base);

  const pixelCount = width * height;
  let current = new Float32Array(pixelCount * 3);
  let next = new Float32Array(pixelCount * 3);

  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const rgba = pixel * 4;
    const rgb = pixel * 3;
    current[rgb] = base[rgba];
    current[rgb + 1] = base[rgba + 1];
    current[rgb + 2] = base[rgba + 2];
  }

  const screening = params.screening ?? 1.15;
  const iterations = params.iterations ?? 16;
  const neighborIndex = (
    x: number,
    y: number,
  ) => {
    const wrappedX = (x + width) % width;
    const clampedY = clamp(y, 0, height - 1);
    return clampedY * width + wrappedX;
  };

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    next.set(current);

    for (const pixel of seamIndices) {
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      const neighbors = [
        neighborIndex(x - 1, y),
        neighborIndex(x + 1, y),
        neighborIndex(x, y - 1),
        neighborIndex(x, y + 1),
      ];
      const rgba = pixel * 4;
      const rgb = pixel * 3;

      for (let channel = 0; channel < 3; channel += 1) {
        let neighborSum = 0;
        let guidanceNeighborSum = 0;
        for (const neighbor of neighbors) {
          neighborSum += current[neighbor * 3 + channel];
          guidanceNeighborSum +=
            guidance[neighbor * 4 + channel];
        }

        const guidanceLaplacian =
          4 * guidance[rgba + channel] -
          guidanceNeighborSum;
        const solved =
          (neighborSum +
            guidanceLaplacian +
            screening * base[rgba + channel]) /
          (4 + screening);

        next[rgb + channel] = clamp(solved, 0, 255);
      }
    }

    [current, next] = [next, current];
  }

  const output = new Uint8ClampedArray(base);
  for (const pixel of seamIndices) {
    const rgba = pixel * 4;
    const rgb = pixel * 3;
    output[rgba] = Math.round(current[rgb]);
    output[rgba + 1] = Math.round(current[rgb + 1]);
    output[rgba + 2] = Math.round(current[rgb + 2]);
  }
  return output;
}

export async function buildBodyTextureAtlas(params: {
  urls: Partial<Record<BodySide, string | null>>;
  silhouettes: Record<BodySide, BodySilhouette>;
  textureCalibration?: BodyTextureCalibration;
  cameraRig?: BodyCameraRig;
  optics?: OpticalCalibrationProfile | null;
  width?: number;
  height?: number;
}) {
  const width = params.width ?? 1024;
  const height = params.height ?? 768;

  const loadedEntries = await Promise.all(
    SIDES.map(async (side) => {
      const url = params.urls[side];
      if (!url) return [side, null] as const;
      const silhouette = params.silhouettes[side];
      let source = await loadImage(
        url,
        silhouette.sourceWidth,
        silhouette.sourceHeight,
      );

      if (params.optics) {
        const intrinsics = opticsForSource(
          source,
          params.optics,
        );
        if (intrinsics) {
          source = undistortRgbaImage(
            source,
            intrinsics,
            params.optics.distortion,
          );
        }
      } else if (params.cameraRig?.distortion) {
        source = undistortRgbaImage(
          source,
          params.cameraRig.intrinsics,
          params.cameraRig.distortion,
        );
      }

      return [side, buildPyramid(source)] as const;
    }),
  );

  const sources = Object.fromEntries(
    loadedEntries,
  ) as Partial<Record<BodySide, SourcePyramid | null>>;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error(
      "Canvas 2D indisponível para atlas corporal.",
    );
  }
  const output = context.createImageData(width, height);
  const guidance = new Uint8ClampedArray(output.data.length);
  const seamMask = new Uint8Array(width * height);

  for (let y = 0; y < height; y += 1) {
    const v = y / Math.max(1, height - 1);

    for (let x = 0; x < width; x += 1) {
      const u = x / Math.max(1, width - 1);
      const angle = (u - 0.5) * Math.PI * 2;

      let lowWeight = 0;
      let midWeight = 0;
      let highWeight = 0;
      let lowR = 0;
      let lowG = 0;
      let lowB = 0;
      let midR = 0;
      let midG = 0;
      let midB = 0;
      let highR = 0;
      let highG = 0;
      let highB = 0;
      let alpha = 0;
      let alphaWeight = 0;
      let dominantWeight = 0;
      let secondWeight = 0;
      let dominantR = 0;
      let dominantG = 0;
      let dominantB = 0;

      for (const side of SIDES) {
        const pyramid = sources[side];
        if (!pyramid) continue;
        const silhouette = params.silhouettes[side];
        const lowW = angularWeight(
          side,
          angle,
          silhouette.confidence,
          92,
          1.4,
        );
        const midW = angularWeight(
          side,
          angle,
          silhouette.confidence,
          78,
          2.4,
        );
        const highW = angularWeight(
          side,
          angle,
          silhouette.confidence,
          66,
          4.2,
        );

        if (lowW <= 0 && midW <= 0 && highW <= 0) {
          continue;
        }

        const point = sourcePoint(
          silhouette,
          side,
          angle,
          v,
        );
        const original = bilinearSample(
          pyramid.original,
          point.x,
          point.y,
        );
        const blur2 = bilinearSample(
          pyramid.blur2,
          point.x,
          point.y,
        );
        const blur8 = bilinearSample(
          pyramid.blur8,
          point.x,
          point.y,
        );
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

        if (lowW > dominantWeight) {
          secondWeight = dominantWeight;
          dominantWeight = lowW;
          dominantR = original[0] * gain[0];
          dominantG = original[1] * gain[1];
          dominantB = original[2] * gain[2];
        } else if (lowW > secondWeight) {
          secondWeight = lowW;
        }

        if (lowW > 0) {
          lowR += blur8[0] * gain[0] * lowW;
          lowG += blur8[1] * gain[1] * lowW;
          lowB += blur8[2] * gain[2] * lowW;
          lowWeight += lowW;
          alpha += original[3] * lowW;
          alphaWeight += lowW;
        }

        if (midW > 0) {
          midR +=
            (blur2[0] - blur8[0]) * gain[0] * midW;
          midG +=
            (blur2[1] - blur8[1]) * gain[1] * midW;
          midB +=
            (blur2[2] - blur8[2]) * gain[2] * midW;
          midWeight += midW;
        }

        if (highW > 0) {
          highR +=
            (original[0] - blur2[0]) *
            gain[0] *
            highW;
          highG +=
            (original[1] - blur2[1]) *
            gain[1] *
            highW;
          highB +=
            (original[2] - blur2[2]) *
            gain[2] *
            highW;
          highWeight += highW;
        }
      }

      const offset = (y * width + x) * 4;
      if (lowWeight > 1e-5) {
        const r =
          lowR / lowWeight +
          (midWeight > 1e-5 ? midR / midWeight : 0) +
          (highWeight > 1e-5 ? highR / highWeight : 0);
        const g =
          lowG / lowWeight +
          (midWeight > 1e-5 ? midG / midWeight : 0) +
          (highWeight > 1e-5 ? highG / highWeight : 0);
        const b =
          lowB / lowWeight +
          (midWeight > 1e-5 ? midB / midWeight : 0) +
          (highWeight > 1e-5 ? highB / highWeight : 0);

        output.data[offset] = clamp(Math.round(r), 0, 255);
        output.data[offset + 1] = clamp(
          Math.round(g),
          0,
          255,
        );
        output.data[offset + 2] = clamp(
          Math.round(b),
          0,
          255,
        );
        output.data[offset + 3] =
          alphaWeight > 1e-5
            ? clamp(
                Math.round(alpha / alphaWeight),
                0,
                255,
              )
            : 0;

        guidance[offset] = clamp(Math.round(dominantR || r), 0, 255);
        guidance[offset + 1] = clamp(Math.round(dominantG || g), 0, 255);
        guidance[offset + 2] = clamp(Math.round(dominantB || b), 0, 255);
        guidance[offset + 3] = output.data[offset + 3];

        const competition =
          dominantWeight > 1e-6
            ? secondWeight / dominantWeight
            : 0;
        seamMask[y * width + x] =
          competition > 0.34 ? 1 : 0;
      }
    }
  }

  const optimized = optimizeGradientDomainSeams({
    base: output.data,
    guidance,
    seamMask,
    width,
    height,
    iterations: 16,
    screening: 1.15,
  });
  output.data.set(optimized);

  context.putImageData(output, 0, 0);
  return canvas;
}

export function bodyAtlasUvs(
  vertices: number[],
  heightCm: number,
  centerZProfile?: number[],
) {
  const uv = new Array<number>((vertices.length / 3) * 2);
  const halfHeight = heightCm / 2;

  for (
    let vertex = 0;
    vertex < vertices.length / 3;
    vertex += 1
  ) {
    const offset = vertex * 3;
    const x = vertices[offset];
    const y = vertices[offset + 1];
    const z = vertices[offset + 2];
    const v = clamp(
      (halfHeight - y) / Math.max(1, heightCm),
      0,
      1,
    );
    const centerZ = centerZProfile?.length
      ? sampleProfile(centerZProfile, v)
      : 0;
    const angle = Math.atan2(x, z - centerZ);
    const u =
      ((angle / (Math.PI * 2) + 0.5) % 1 + 1) % 1;

    uv[vertex * 2] = u;
    uv[vertex * 2 + 1] = v;
  }

  return uv;
}
