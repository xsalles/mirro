import type {
  BodyCalibration,
  BodyMeasurements,
  BodyMesh,
  BodySide,
  BodySilhouette,
} from "./types";

export type RgbaImage = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
};

export type SegmentedSilhouette = {
  mask: Uint8Array;
  silhouette: BodySilhouette;
};

const DEFAULT_PROFILE_SAMPLES = 64;
const DEFAULT_RING_SEGMENTS = 32;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function colorDistanceSq(r: number, g: number, b: number, bg: [number, number, number]) {
  const dr = r - bg[0];
  const dg = g - bg[1];
  const db = b - bg[2];
  return dr * dr + dg * dg + db * db;
}

function medianChannel(values: number[]) {
  const histogram = new Uint32Array(256);
  for (const value of values) histogram[value] += 1;
  const midpoint = Math.floor(values.length / 2);
  let seen = 0;
  for (let i = 0; i < histogram.length; i += 1) {
    seen += histogram[i];
    if (seen > midpoint) return i;
  }
  return 0;
}

function estimateBackground(image: RgbaImage) {
  const { width, height, data } = image;
  const minDimension = Math.min(width, height);
  const border = Math.max(2, Math.round(minDimension * 0.035));
  const stride = Math.max(1, Math.round(minDimension / 140));
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];

  function sample(x: number, y: number) {
    const index = (y * width + x) * 4;
    if (data[index + 3] < 32) return;
    rs.push(data[index]);
    gs.push(data[index + 1]);
    bs.push(data[index + 2]);
  }

  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < border; x += stride) sample(x, y);
    for (let x = Math.max(0, width - border); x < width; x += stride) sample(x, y);
  }
  for (let x = 0; x < width; x += stride) {
    for (let y = 0; y < border; y += stride) sample(x, y);
    for (let y = Math.max(0, height - border); y < height; y += stride) sample(x, y);
  }

  if (rs.length === 0) throw new Error("Não foi possível estimar o fundo da foto.");

  const background: [number, number, number] = [
    medianChannel(rs),
    medianChannel(gs),
    medianChannel(bs),
  ];

  const distances: number[] = [];
  for (let i = 0; i < rs.length; i += 1) {
    distances.push(Math.sqrt(colorDistanceSq(rs[i], gs[i], bs[i], background)));
  }
  distances.sort((a, b) => a - b);
  const p90 = distances[Math.floor((distances.length - 1) * 0.9)] ?? 0;
  const threshold = clamp(p90 + 18, 28, 74);

  return { background, threshold, borderSpread: p90 };
}

function connectedBackground(image: RgbaImage, background: [number, number, number], threshold: number) {
  const { width, height, data } = image;
  const pixelCount = width * height;
  const candidate = new Uint8Array(pixelCount);
  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  const thresholdSq = threshold * threshold;

  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 4;
    const alpha = data[offset + 3];
    if (
      alpha < 32 ||
      colorDistanceSq(data[offset], data[offset + 1], data[offset + 2], background) <= thresholdSq
    ) {
      candidate[index] = 1;
    }
  }

  let head = 0;
  let tail = 0;

  function seed(index: number) {
    if (!candidate[index] || visited[index]) return;
    visited[index] = 1;
    queue[tail] = index;
    tail += 1;
  }

  for (let x = 0; x < width; x += 1) {
    seed(x);
    seed((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    seed(y * width);
    seed(y * width + width - 1);
  }

  while (head < tail) {
    const current = queue[head];
    head += 1;
    const x = current % width;
    const y = Math.floor(current / width);

    if (x > 0) seed(current - 1);
    if (x + 1 < width) seed(current + 1);
    if (y > 0) seed(current - width);
    if (y + 1 < height) seed(current + width);
  }

  return visited;
}

function largestForegroundComponent(backgroundMask: Uint8Array, width: number, height: number) {
  const pixelCount = width * height;
  const labels = new Int32Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let componentId = 0;
  let largestId = 0;
  let largestSize = 0;

  const neighborOffsets = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0], [1, 0],
    [-1, 1], [0, 1], [1, 1],
  ] as const;

  for (let start = 0; start < pixelCount; start += 1) {
    if (backgroundMask[start] || labels[start]) continue;

    componentId += 1;
    let head = 0;
    let tail = 0;
    let size = 0;
    labels[start] = componentId;
    queue[tail] = start;
    tail += 1;

    while (head < tail) {
      const current = queue[head];
      head += 1;
      size += 1;
      const x = current % width;
      const y = Math.floor(current / width);

      for (const [dx, dy] of neighborOffsets) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const next = ny * width + nx;
        if (backgroundMask[next] || labels[next]) continue;
        labels[next] = componentId;
        queue[tail] = next;
        tail += 1;
      }
    }

    if (size > largestSize) {
      largestSize = size;
      largestId = componentId;
    }
  }

  const mask = new Uint8Array(pixelCount);
  if (!largestId) return { mask, foregroundPixels: 0 };

  for (let index = 0; index < pixelCount; index += 1) {
    if (labels[index] === largestId) mask[index] = 1;
  }

  return { mask, foregroundPixels: largestSize };
}

function findBounds(mask: Uint8Array, width: number, height: number) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[y * width + x]) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < minX || maxY < minY) throw new Error("Nenhuma silhueta utilizável foi encontrada.");

  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

function smoothProfile(values: number[], radius = 2) {
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

function buildWidthProfile(
  mask: Uint8Array,
  width: number,
  bounds: { x: number; y: number; width: number; height: number },
  sampleCount: number,
) {
  const values = new Array<number>(sampleCount).fill(0);

  for (let sample = 0; sample < sampleCount; sample += 1) {
    const t = sampleCount === 1 ? 0 : sample / (sampleCount - 1);
    const centerY = bounds.y + Math.round(t * (bounds.height - 1));
    let totalWidth = 0;
    let rows = 0;

    for (let dy = -1; dy <= 1; dy += 1) {
      const y = centerY + dy;
      if (y < bounds.y || y >= bounds.y + bounds.height) continue;

      let minX = width;
      let maxX = -1;
      for (let x = bounds.x; x < bounds.x + bounds.width; x += 1) {
        if (!mask[y * width + x]) continue;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
      }

      if (maxX >= minX) {
        totalWidth += maxX - minX + 1;
        rows += 1;
      }
    }

    values[sample] = rows ? totalWidth / rows / bounds.height : 0;
  }

  for (let i = 0; i < values.length; i += 1) {
    if (values[i] > 0) continue;
    let left = i - 1;
    let right = i + 1;
    while (left >= 0 && values[left] === 0) left -= 1;
    while (right < values.length && values[right] === 0) right += 1;
    if (left >= 0 && right < values.length) values[i] = (values[left] + values[right]) / 2;
    else if (left >= 0) values[i] = values[left];
    else if (right < values.length) values[i] = values[right];
  }

  return smoothProfile(values, 2);
}

function countEdgeTouches(mask: Uint8Array, width: number, height: number) {
  let touches = 0;
  for (let x = 0; x < width; x += 1) {
    touches += mask[x];
    touches += mask[(height - 1) * width + x];
  }
  for (let y = 1; y < height - 1; y += 1) {
    touches += mask[y * width];
    touches += mask[y * width + width - 1];
  }
  return touches;
}

export function segmentBodySilhouette(
  image: RgbaImage,
  sampleCount = DEFAULT_PROFILE_SAMPLES,
): SegmentedSilhouette {
  if (image.width < 40 || image.height < 80) {
    throw new Error("A foto tem resolução baixa demais para calibrar a silhueta.");
  }

  const { background, threshold, borderSpread } = estimateBackground(image);
  const backgroundMask = connectedBackground(image, background, threshold + 18);
  const { mask, foregroundPixels } = largestForegroundComponent(
    backgroundMask,
    image.width,
    image.height,
  );

  const totalPixels = image.width * image.height;
  if (foregroundPixels < totalPixels * 0.025) {
    throw new Error("A pessoa não ficou separada do fundo. Use um fundo com mais contraste.");
  }

  const bounds = findBounds(mask, image.width, image.height);
  if (bounds.height < image.height * 0.48) {
    throw new Error("O corpo precisa aparecer quase inteiro na foto.");
  }

  const widthProfile = buildWidthProfile(mask, image.width, bounds, sampleCount);
  const edgeTouches = countEdgeTouches(mask, image.width, image.height);
  const perimeter = Math.max(1, image.width * 2 + image.height * 2 - 4);
  const bodyHeightRatio = bounds.height / image.height;
  const foregroundRatio = foregroundPixels / totalPixels;
  const coverageScore = clamp((bodyHeightRatio - 0.45) / 0.45, 0, 1);
  const edgeScore = 1 - clamp((edgeTouches / perimeter) * 7, 0, 1);
  const backgroundScore = 1 - clamp(borderSpread / 90, 0, 1);
  const occupancyScore = 1 - clamp(Math.abs(foregroundRatio - 0.28) / 0.35, 0, 1);
  const confidence = clamp(
    coverageScore * 0.38 + edgeScore * 0.28 + backgroundScore * 0.22 + occupancyScore * 0.12,
    0,
    1,
  );

  return {
    mask,
    silhouette: {
      sourceWidth: image.width,
      sourceHeight: image.height,
      bounds,
      widthProfile,
      foregroundRatio,
      backgroundThreshold: threshold,
      confidence,
    },
  };
}

function weightedProfile(a: BodySilhouette, b: BodySilhouette) {
  const totalWeight = Math.max(0.01, a.confidence + b.confidence);
  return a.widthProfile.map(
    (value, index) =>
      (value * a.confidence + b.widthProfile[index] * b.confidence) / totalWeight,
  );
}

function meanAbsoluteDifference(a: number[], b: number[]) {
  let total = 0;
  const count = Math.min(a.length, b.length);
  for (let i = 0; i < count; i += 1) total += Math.abs(a[i] - b[i]);
  return count ? total / count : 1;
}

function findLandmark(
  profile: number[],
  startRatio: number,
  endRatio: number,
  mode: "min" | "max",
) {
  const start = clamp(Math.floor(profile.length * startRatio), 0, profile.length - 1);
  const end = clamp(Math.ceil(profile.length * endRatio), start + 1, profile.length);
  let bestIndex = start;
  let bestValue = profile[start];

  for (let index = start + 1; index < end; index += 1) {
    const isBetter = mode === "max" ? profile[index] > bestValue : profile[index] < bestValue;
    if (isBetter) {
      bestValue = profile[index];
      bestIndex = index;
    }
  }

  return bestIndex;
}

function ellipseCircumference(radiusA: number, radiusB: number) {
  const a = Math.max(radiusA, 0.01);
  const b = Math.max(radiusB, 0.01);
  const h = ((a - b) ** 2) / ((a + b) ** 2);
  return Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
}

function addFaceNormal(
  vertices: number[],
  normals: number[],
  ia: number,
  ib: number,
  ic: number,
) {
  const ax = vertices[ia * 3];
  const ay = vertices[ia * 3 + 1];
  const az = vertices[ia * 3 + 2];
  const bx = vertices[ib * 3];
  const by = vertices[ib * 3 + 1];
  const bz = vertices[ib * 3 + 2];
  const cx = vertices[ic * 3];
  const cy = vertices[ic * 3 + 1];
  const cz = vertices[ic * 3 + 2];

  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const acx = cx - ax;
  const acy = cy - ay;
  const acz = cz - az;

  const nx = aby * acz - abz * acy;
  const ny = abz * acx - abx * acz;
  const nz = abx * acy - aby * acx;

  for (const index of [ia, ib, ic]) {
    normals[index * 3] += nx;
    normals[index * 3 + 1] += ny;
    normals[index * 3 + 2] += nz;
  }
}

function buildMesh(
  radiusX: number[],
  radiusZ: number[],
  heightCm: number,
  landmarks: BodyMesh["landmarks"],
  segmentsPerRing = DEFAULT_RING_SEGMENTS,
): BodyMesh {
  const ringCount = radiusX.length;
  const vertices: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  for (let ring = 0; ring < ringCount; ring += 1) {
    const t = ringCount === 1 ? 0 : ring / (ringCount - 1);
    const y = heightCm / 2 - t * heightCm;
    const rx = Math.max(0.65, radiusX[ring]);
    const rz = Math.max(0.65, radiusZ[ring]);

    for (let segment = 0; segment < segmentsPerRing; segment += 1) {
      const angle = (segment / segmentsPerRing) * Math.PI * 2;
      vertices.push(Math.cos(angle) * rx, y, Math.sin(angle) * rz);
      normals.push(0, 0, 0);
    }
  }

  for (let ring = 0; ring < ringCount - 1; ring += 1) {
    for (let segment = 0; segment < segmentsPerRing; segment += 1) {
      const nextSegment = (segment + 1) % segmentsPerRing;
      const a = ring * segmentsPerRing + segment;
      const d = ring * segmentsPerRing + nextSegment;
      const b = (ring + 1) * segmentsPerRing + segment;
      const c = (ring + 1) * segmentsPerRing + nextSegment;
      indices.push(a, d, b, d, c, b);
    }
  }

  const topCenter = vertices.length / 3;
  vertices.push(0, heightCm / 2, 0);
  normals.push(0, 0, 0);
  const bottomCenter = vertices.length / 3;
  vertices.push(0, -heightCm / 2, 0);
  normals.push(0, 0, 0);

  for (let segment = 0; segment < segmentsPerRing; segment += 1) {
    const next = (segment + 1) % segmentsPerRing;
    indices.push(topCenter, next, segment);
    const bottomStart = (ringCount - 1) * segmentsPerRing;
    indices.push(bottomCenter, bottomStart + segment, bottomStart + next);
  }

  for (let offset = 0; offset < indices.length; offset += 3) {
    addFaceNormal(vertices, normals, indices[offset], indices[offset + 1], indices[offset + 2]);
  }

  for (let index = 0; index < normals.length; index += 3) {
    const nx = normals[index];
    const ny = normals[index + 1];
    const nz = normals[index + 2];
    const length = Math.hypot(nx, ny, nz) || 1;
    normals[index] = nx / length;
    normals[index + 1] = ny / length;
    normals[index + 2] = nz / length;
  }

  return {
    version: 1,
    coordinateSystem: "x-right-y-up-z-front-centimeters",
    ringCount,
    segmentsPerRing,
    vertices,
    normals,
    indices,
    landmarks,
    boundsCm: {
      width: Math.max(...radiusX) * 2,
      height: heightCm,
      depth: Math.max(...radiusZ) * 2,
    },
  };
}

export function buildBodyCalibration(
  silhouettes: Record<BodySide, BodySilhouette>,
  measurements: BodyMeasurements,
): BodyCalibration {
  const sampleCount = silhouettes.front.widthProfile.length;
  const views = Object.values(silhouettes);

  if (
    views.some((view) => view.widthProfile.length !== sampleCount) ||
    sampleCount < 16
  ) {
    throw new Error("As quatro silhuetas precisam usar a mesma resolução de calibração.");
  }

  const frontal = weightedProfile(silhouettes.front, silhouettes.back);
  const lateral = weightedProfile(silhouettes.right, silhouettes.left);

  const chestRing = findLandmark(frontal, 0.23, 0.37, "max");
  const waistRing = findLandmark(frontal, 0.36, 0.5, "min");
  const hipsRing = findLandmark(frontal, 0.46, 0.61, "max");

  const radiusX = frontal.map((value) => Math.max(0.65, (value * measurements.heightCm) / 2));
  const radiusZ = lateral.map((value) => Math.max(0.65, (value * measurements.heightCm) / 2));

  const targets = [
    { ring: chestRing, circumference: measurements.chestCm },
    { ring: waistRing, circumference: measurements.waistCm },
    { ring: hipsRing, circumference: measurements.hipsCm },
  ].map((target) => {
    const current = ellipseCircumference(radiusX[target.ring], radiusZ[target.ring]);
    return {
      ...target,
      scale: clamp(target.circumference / Math.max(current, 1), 0.65, 1.55),
    };
  });

  const sigma = Math.max(1.5, sampleCount * 0.04);
  for (let ring = 0; ring < sampleCount; ring += 1) {
    let weightedDelta = 0;
    let totalWeight = 0;

    for (const target of targets) {
      const distance = ring - target.ring;
      const weight = Math.exp(-(distance * distance) / (2 * sigma * sigma));
      weightedDelta += (target.scale - 1) * weight;
      totalWeight += weight;
    }

    const factor = 1 + (totalWeight > 0 ? weightedDelta / Math.max(1, totalWeight) : 0);
    radiusX[ring] *= factor;
    radiusZ[ring] *= factor;
  }

  const landmarks = {
    chestRing,
    waistRing,
    hipsRing,
  };

  const mesh = buildMesh(radiusX, radiusZ, measurements.heightCm, landmarks);
  const frontBackDifference = meanAbsoluteDifference(
    silhouettes.front.widthProfile,
    silhouettes.back.widthProfile,
  );
  const sideDifference = meanAbsoluteDifference(
    silhouettes.left.widthProfile,
    silhouettes.right.widthProfile,
  );
  const averageViewConfidence =
    views.reduce((sum, view) => sum + view.confidence, 0) / views.length;
  const consistencyScore = clamp(1 - (frontBackDifference + sideDifference) * 5, 0, 1);
  const score = clamp(averageViewConfidence * 0.72 + consistencyScore * 0.28, 0, 1);
  const warnings: string[] = [];

  if (views.some((view) => view.confidence < 0.5)) {
    warnings.push("Uma das fotos tem separação fraca entre corpo e fundo.");
  }
  if (frontBackDifference > 0.075) {
    warnings.push("Frente e costas estão com escala ou pose diferentes.");
  }
  if (sideDifference > 0.065) {
    warnings.push("As duas laterais estão com escala ou pose diferentes.");
  }
  if (score < 0.58) {
    warnings.push("Refaça as fotos com corpo inteiro, fundo contrastante e câmera na mesma altura.");
  }

  return {
    version: 1,
    method: "weak-perspective-elliptical-hull-v1",
    sampleCount,
    silhouettes,
    mesh,
    quality: {
      score,
      frontBackDifference,
      sideDifference,
      warnings,
    },
    createdAt: new Date().toISOString(),
  };
}
