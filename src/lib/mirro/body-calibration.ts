import type {
  BodyCalibration,
  BodyMeasurements,
  BodyMesh,
  BodyPartKind,
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

const DEFAULT_PROFILE_SAMPLES = 96;
const DEFAULT_RING_SEGMENTS = 48;

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

function buildCenterProfile(
  mask: Uint8Array,
  width: number,
  bounds: { x: number; y: number; width: number; height: number },
  sampleCount: number,
) {
  const values = new Array<number>(sampleCount).fill(0);
  const boundsCenter = bounds.x + bounds.width / 2;

  for (let sample = 0; sample < sampleCount; sample += 1) {
    const t = sampleCount === 1 ? 0 : sample / (sampleCount - 1);
    const centerY = bounds.y + Math.round(t * (bounds.height - 1));
    let totalCenter = 0;
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
        totalCenter += (minX + maxX) / 2;
        rows += 1;
      }
    }

    values[sample] = rows
      ? (totalCenter / rows - boundsCenter) / bounds.height
      : 0;
  }

  return smoothProfile(values, 3);
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
  const centerProfile = buildCenterProfile(
    mask,
    image.width,
    bounds,
    sampleCount,
  );
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
      centerProfile,
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

function weightedMetricProfile(a: BodySilhouette, b: BodySilhouette) {
  if (!a.metricWidthProfileCm || !b.metricWidthProfileCm) return null;
  const totalWeight = Math.max(0.01, a.confidence + b.confidence);
  return a.metricWidthProfileCm.map(
    (value, index) =>
      (value * a.confidence + (b.metricWidthProfileCm?.[index] ?? value) * b.confidence) /
      totalWeight,
  );
}

function weightedCenterProfile(
  right: BodySilhouette,
  left: BodySilhouette,
) {
  if (!right.centerProfile || !left.centerProfile) return null;
  const totalWeight = Math.max(0.01, right.confidence + left.confidence);
  return right.centerProfile.map(
    (value, index) =>
      (-value * right.confidence +
        (left.centerProfile?.[index] ?? -value) * left.confidence) /
      totalWeight,
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

type Vec3 = [number, number, number];

function vecSub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function vecLength(v: Vec3) {
  return Math.hypot(v[0], v[1], v[2]);
}

function vecNormalize(v: Vec3): Vec3 {
  const length = vecLength(v) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

function vecCross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function bodyY(heightCm: number, ring: number, ringCount: number) {
  const t = clamp(ring, 0, ringCount - 1) / Math.max(1, ringCount - 1);
  return heightCm / 2 - t * heightCm;
}

function finalizeNormals(vertices: number[], normals: number[], indices: number[]) {
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
}

function appendEllipticalTorso(params: {
  vertices: number[];
  normals: number[];
  indices: number[];
  radiusX: number[];
  radiusZ: number[];
  centerZ: number[];
  heightCm: number;
  startRing: number;
  endRing: number;
  segments: number;
}) {
  const {
    vertices,
    normals,
    indices,
    radiusX,
    radiusZ,
    centerZ,
    heightCm,
    startRing,
    endRing,
    segments,
  } = params;
  const vertexStart = vertices.length / 3;
  const indexStart = indices.length;
  const sourceRingCount = radiusX.length;
  const localRingCount = endRing - startRing + 1;

  for (let localRing = 0; localRing < localRingCount; localRing += 1) {
    const sourceRing = startRing + localRing;
    const y = bodyY(heightCm, sourceRing, sourceRingCount);
    const rx = Math.max(0.65, radiusX[sourceRing]);
    const rz = Math.max(0.65, radiusZ[sourceRing]);

    for (let segment = 0; segment < segments; segment += 1) {
      const angle = (segment / segments) * Math.PI * 2;
      vertices.push(
        Math.cos(angle) * rx,
        y,
        (centerZ[sourceRing] ?? 0) + Math.sin(angle) * rz,
      );
      normals.push(0, 0, 0);
    }
  }

  for (let ring = 0; ring < localRingCount - 1; ring += 1) {
    for (let segment = 0; segment < segments; segment += 1) {
      const next = (segment + 1) % segments;
      const a = vertexStart + ring * segments + segment;
      const d = vertexStart + ring * segments + next;
      const b = vertexStart + (ring + 1) * segments + segment;
      const cc = vertexStart + (ring + 1) * segments + next;
      indices.push(a, d, b, d, cc, b);
    }
  }

  const topCenter = vertices.length / 3;
  vertices.push(
    0,
    bodyY(heightCm, startRing, sourceRingCount),
    centerZ[startRing] ?? 0,
  );
  normals.push(0, 0, 0);
  const bottomCenter = vertices.length / 3;
  vertices.push(
    0,
    bodyY(heightCm, endRing, sourceRingCount),
    centerZ[endRing] ?? 0,
  );
  normals.push(0, 0, 0);

  for (let segment = 0; segment < segments; segment += 1) {
    const next = (segment + 1) % segments;
    indices.push(topCenter, vertexStart + next, vertexStart + segment);
    const bottomStart = vertexStart + (localRingCount - 1) * segments;
    indices.push(bottomCenter, bottomStart + segment, bottomStart + next);
  }

  return {
    vertexStart,
    vertexCount: vertices.length / 3 - vertexStart,
    indexStart,
    indexCount: indices.length - indexStart,
  };
}

function appendEllipsoid(params: {
  vertices: number[];
  normals: number[];
  indices: number[];
  center: Vec3;
  radii: Vec3;
  latSegments?: number;
  lonSegments?: number;
}) {
  const {
    vertices,
    normals,
    indices,
    center,
    radii,
    latSegments = 12,
    lonSegments = 18,
  } = params;
  const vertexStart = vertices.length / 3;
  const indexStart = indices.length;

  for (let lat = 0; lat <= latSegments; lat += 1) {
    const v = lat / latSegments;
    const phi = v * Math.PI;
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);

    for (let lon = 0; lon <= lonSegments; lon += 1) {
      const u = lon / lonSegments;
      const theta = u * Math.PI * 2;
      vertices.push(
        center[0] + Math.cos(theta) * sinPhi * radii[0],
        center[1] + cosPhi * radii[1],
        center[2] + Math.sin(theta) * sinPhi * radii[2],
      );
      normals.push(0, 0, 0);
    }
  }

  const stride = lonSegments + 1;
  for (let lat = 0; lat < latSegments; lat += 1) {
    for (let lon = 0; lon < lonSegments; lon += 1) {
      const a = vertexStart + lat * stride + lon;
      const b = a + stride;
      const d = a + 1;
      const cc = b + 1;
      if (lat > 0) indices.push(a, d, b);
      if (lat < latSegments - 1) indices.push(d, cc, b);
    }
  }

  return {
    vertexStart,
    vertexCount: vertices.length / 3 - vertexStart,
    indexStart,
    indexCount: indices.length - indexStart,
  };
}

function appendTaperedLimb(params: {
  vertices: number[];
  normals: number[];
  indices: number[];
  start: Vec3;
  end: Vec3;
  startRadius: number;
  endRadius: number;
  rings?: number;
  segments?: number;
}) {
  const {
    vertices,
    normals,
    indices,
    start,
    end,
    startRadius,
    endRadius,
    rings = 9,
    segments = 14,
  } = params;
  const vertexStart = vertices.length / 3;
  const indexStart = indices.length;
  const axis = vecNormalize(vecSub(end, start));
  const helper: Vec3 = Math.abs(axis[1]) < 0.88 ? [0, 1, 0] : [0, 0, 1];
  const basisA = vecNormalize(vecCross(axis, helper));
  const basisB = vecNormalize(vecCross(axis, basisA));

  for (let ring = 0; ring <= rings; ring += 1) {
    const t = ring / rings;
    const center: Vec3 = [
      start[0] + (end[0] - start[0]) * t,
      start[1] + (end[1] - start[1]) * t,
      start[2] + (end[2] - start[2]) * t,
    ];
    const radius = startRadius + (endRadius - startRadius) * t;

    for (let segment = 0; segment < segments; segment += 1) {
      const angle = (segment / segments) * Math.PI * 2;
      const ca = Math.cos(angle) * radius;
      const sb = Math.sin(angle) * radius;
      vertices.push(
        center[0] + basisA[0] * ca + basisB[0] * sb,
        center[1] + basisA[1] * ca + basisB[1] * sb,
        center[2] + basisA[2] * ca + basisB[2] * sb,
      );
      normals.push(0, 0, 0);
    }
  }

  for (let ring = 0; ring < rings; ring += 1) {
    for (let segment = 0; segment < segments; segment += 1) {
      const next = (segment + 1) % segments;
      const a = vertexStart + ring * segments + segment;
      const d = vertexStart + ring * segments + next;
      const b = vertexStart + (ring + 1) * segments + segment;
      const cc = vertexStart + (ring + 1) * segments + next;
      indices.push(a, d, b, d, cc, b);
    }
  }

  const startCenter = vertices.length / 3;
  vertices.push(...start);
  normals.push(0, 0, 0);
  const endCenter = vertices.length / 3;
  vertices.push(...end);
  normals.push(0, 0, 0);

  for (let segment = 0; segment < segments; segment += 1) {
    const next = (segment + 1) % segments;
    indices.push(startCenter, vertexStart + segment, vertexStart + next);
    const endStart = vertexStart + rings * segments;
    indices.push(endCenter, endStart + next, endStart + segment);
  }

  return {
    vertexStart,
    vertexCount: vertices.length / 3 - vertexStart,
    indexStart,
    indexCount: indices.length - indexStart,
  };
}

function partBounds(vertices: number[], vertexStart: number, vertexCount: number) {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (let index = vertexStart; index < vertexStart + vertexCount; index += 1) {
    const offset = index * 3;
    minX = Math.min(minX, vertices[offset]);
    minY = Math.min(minY, vertices[offset + 1]);
    minZ = Math.min(minZ, vertices[offset + 2]);
    maxX = Math.max(maxX, vertices[offset]);
    maxY = Math.max(maxY, vertices[offset + 1]);
    maxZ = Math.max(maxZ, vertices[offset + 2]);
  }

  return {
    centerCm: [
      (minX + maxX) / 2,
      (minY + maxY) / 2,
      (minZ + maxZ) / 2,
    ] as Vec3,
    boundsCm: {
      width: maxX - minX,
      height: maxY - minY,
      depth: maxZ - minZ,
    },
  };
}

function buildAnatomicalMesh(
  radiusX: number[],
  radiusZ: number[],
  centerZProfile: number[],
  measurements: BodyMeasurements,
  landmarks: BodyMesh["landmarks"],
  version: 2 | 3 | 4,
  segmentsPerRing = DEFAULT_RING_SEGMENTS,
): BodyMesh {
  const heightCm = measurements.heightCm;
  const vertices: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const parts: NonNullable<BodyMesh["parts"]> = [];
  const collisionPrimitives: NonNullable<BodyMesh["collisionPrimitives"]> = [];
  const ringCount = radiusX.length;
  const torsoTopRing = clamp(
    landmarks.shoulderRing ?? Math.round(ringCount * 0.17),
    1,
    ringCount - 4,
  );
  const torsoBottomRing = clamp(
    landmarks.crotchRing ?? Math.round(ringCount * 0.63),
    torsoTopRing + 3,
    ringCount - 2,
  );

  const torsoRadiusX = [...radiusX];
  const torsoRadiusZ = [...radiusZ];
  const torsoCenterZ = [...centerZProfile];
  const torsoWidthCap = Math.max(
    radiusX[landmarks.chestRing] * 1.22,
    radiusX[landmarks.hipsRing] * 1.14,
  );

  for (let ring = torsoTopRing; ring <= torsoBottomRing; ring += 1) {
    torsoRadiusX[ring] = Math.min(torsoRadiusX[ring], torsoWidthCap);
  }

  const torsoGeometry = appendEllipticalTorso({
    vertices,
    normals,
    indices,
    radiusX: torsoRadiusX,
    radiusZ: torsoRadiusZ,
    centerZ: torsoCenterZ,
    heightCm,
    startRing: torsoTopRing,
    endRing: torsoBottomRing,
    segments: segmentsPerRing,
  });
  const torsoMeta = partBounds(
    vertices,
    torsoGeometry.vertexStart,
    torsoGeometry.vertexCount,
  );
  parts.push({
    kind: "torso",
    ...torsoGeometry,
    ...torsoMeta,
  });
  collisionPrimitives.push({
    type: "elliptical-hull",
    part: "torso",
    topY: bodyY(heightCm, torsoTopRing, ringCount),
    bottomY: bodyY(heightCm, torsoBottomRing, ringCount),
    radiusX: torsoRadiusX.slice(torsoTopRing, torsoBottomRing + 1),
    radiusZ: torsoRadiusZ.slice(torsoTopRing, torsoBottomRing + 1),
    centerZ: torsoCenterZ.slice(torsoTopRing, torsoBottomRing + 1),
  });

  const neckRadiusCm = measurements.neckCm
    ? clamp(measurements.neckCm / (Math.PI * 2), 3.6, 7.8)
    : undefined;
  const headRadii: Vec3 = [
    neckRadiusCm
      ? clamp(neckRadiusCm * 1.3, heightCm * 0.038, heightCm * 0.052)
      : heightCm * 0.045,
    heightCm * 0.067,
    neckRadiusCm
      ? clamp(neckRadiusCm * 1.15, heightCm * 0.046, heightCm * 0.061)
      : heightCm * 0.054,
  ];
  const headCenter: Vec3 = [
    0,
    heightCm / 2 - headRadii[1],
    torsoCenterZ[Math.max(0, torsoTopRing - 1)] ?? 0,
  ];
  const headGeometry = appendEllipsoid({
    vertices,
    normals,
    indices,
    center: headCenter,
    radii: headRadii,
  });
  parts.push({
    kind: "head",
    ...headGeometry,
    ...partBounds(vertices, headGeometry.vertexStart, headGeometry.vertexCount),
  });
  collisionPrimitives.push({
    type: "ellipsoid",
    part: "head",
    center: headCenter,
    radii: headRadii,
  });

  const shoulderY = bodyY(heightCm, torsoTopRing + 2, ringCount);
  const shoulderIndex = Math.min(torsoBottomRing, torsoTopRing + 2);
  const shoulderRadiusX = torsoRadiusX[shoulderIndex];
  const shoulderCenterZ = torsoCenterZ[shoulderIndex] ?? 0;
  const shoulderHalfWidth = measurements.shoulderWidthCm
    ? clamp(measurements.shoulderWidthCm / 2, shoulderRadiusX * 0.72, shoulderRadiusX * 1.22)
    : shoulderRadiusX * 0.9;
  const armStartRadius = measurements.upperArmCm
    ? clamp(measurements.upperArmCm / (Math.PI * 2), 3.5, 7.8)
    : clamp(heightCm * 0.029, 4.2, 6.3);
  const forearmRadiusCm = measurements.forearmCm
    ? clamp(measurements.forearmCm / (Math.PI * 2), 2.8, 6.2)
    : undefined;
  const armEndRadius = forearmRadiusCm
    ? clamp(forearmRadiusCm * 0.78, 2.6, 4.9)
    : clamp(armStartRadius * 0.64, 2.6, 4.8);
  const shoulderSlopeDeg = clamp(
    measurements.shoulderSlopeDeg ?? 8,
    0,
    25,
  );
  const shoulderDropCm =
    Math.tan((shoulderSlopeDeg * Math.PI) / 180) *
    shoulderHalfWidth;
  const shoulderJointY = shoulderY - shoulderDropCm;
  const armLength = measurements.armLengthCm
    ? clamp(measurements.armLengthCm, heightCm * 0.22, heightCm * 0.42)
    : heightCm * 0.31;
  const armHorizontalDrift = Math.max(0.8, shoulderRadiusX * 0.16);
  const armVerticalLength = Math.sqrt(
    Math.max(1, armLength * armLength - armHorizontalDrift * armHorizontalDrift),
  );
  const wristY = shoulderJointY - armVerticalLength;

  for (const side of [-1, 1] as const) {
    const kind: BodyPartKind = side < 0 ? "left-arm" : "right-arm";
    const startPoint: Vec3 = [
      side * shoulderHalfWidth,
      shoulderJointY,
      shoulderCenterZ,
    ];
    const endPoint: Vec3 = [
      side * (shoulderHalfWidth + armHorizontalDrift),
      wristY,
      shoulderCenterZ + heightCm * 0.006,
    ];
    const geometry = appendTaperedLimb({
      vertices,
      normals,
      indices,
      start: startPoint,
      end: endPoint,
      startRadius: armStartRadius,
      endRadius: armEndRadius,
    });
    parts.push({
      kind,
      ...geometry,
      ...partBounds(vertices, geometry.vertexStart, geometry.vertexCount),
    });
    collisionPrimitives.push({
      type: "tapered-capsule",
      part: kind,
      start: startPoint,
      end: endPoint,
      startRadius: armStartRadius,
      endRadius: armEndRadius,
    });
  }

  const hipRadiusX = torsoRadiusX[landmarks.hipsRing];
  const hipCenterZ = torsoCenterZ[landmarks.hipsRing] ?? 0;
  const crotchY = bodyY(heightCm, torsoBottomRing, ringCount);
  const defaultAnkleY = -heightCm / 2 + heightCm * 0.025;
  const ankleY = measurements.inseamCm
    ? clamp(
        crotchY - measurements.inseamCm * 0.965,
        -heightCm / 2 + heightCm * 0.018,
        crotchY - heightCm * 0.18,
      )
    : defaultAnkleY;
  const thighRadius = measurements.thighCm
    ? clamp(measurements.thighCm / (Math.PI * 2), 5.2, 10.5)
    : clamp(hipRadiusX * 0.4, 5.8, heightCm * 0.052);
  const calfRadiusCm = measurements.calfCm
    ? clamp(measurements.calfCm / (Math.PI * 2), 4.0, 8.2)
    : undefined;
  const ankleRadius = calfRadiusCm
    ? clamp(calfRadiusCm * 0.62, 3.0, 5.3)
    : clamp(thighRadius * 0.5, 3.0, 5.2);

  for (const side of [-1, 1] as const) {
    const kind: BodyPartKind = side < 0 ? "left-leg" : "right-leg";
    const startPoint: Vec3 = [
      side * hipRadiusX * 0.43,
      crotchY + thighRadius * 0.25,
      hipCenterZ,
    ];
    const endPoint: Vec3 = [
      side * hipRadiusX * 0.45,
      ankleY,
      hipCenterZ * 0.35,
    ];
    const geometry = appendTaperedLimb({
      vertices,
      normals,
      indices,
      start: startPoint,
      end: endPoint,
      startRadius: thighRadius,
      endRadius: ankleRadius,
      rings: 12,
      segments: 16,
    });
    parts.push({
      kind,
      ...geometry,
      ...partBounds(vertices, geometry.vertexStart, geometry.vertexCount),
    });
    collisionPrimitives.push({
      type: "tapered-capsule",
      part: kind,
      start: startPoint,
      end: endPoint,
      startRadius: thighRadius,
      endRadius: ankleRadius,
    });
  }

  finalizeNormals(vertices, normals, indices);

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let index = 0; index < vertices.length; index += 3) {
    minX = Math.min(minX, vertices[index]);
    minY = Math.min(minY, vertices[index + 1]);
    minZ = Math.min(minZ, vertices[index + 2]);
    maxX = Math.max(maxX, vertices[index]);
    maxY = Math.max(maxY, vertices[index + 1]);
    maxZ = Math.max(maxZ, vertices[index + 2]);
  }

  return {
    version,
    coordinateSystem: "x-right-y-up-z-front-centimeters",
    ringCount,
    segmentsPerRing,
    vertices,
    normals,
    indices,
    landmarks,
    radiusXProfile: torsoRadiusX,
    radiusZProfile: torsoRadiusZ,
    centerZProfile: torsoCenterZ,
    torsoTopRing,
    torsoBottomRing,
    parts,
    collisionPrimitives,
    semanticMeasurements: {
      neckRadiusCm,
      forearmRadiusCm,
      calfRadiusCm,
      shoulderSlopeDeg,
    },
    boundsCm: {
      width: maxX - minX,
      height: Math.max(heightCm, maxY - minY),
      depth: maxZ - minZ,
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
  const metricFrontal = weightedMetricProfile(
    silhouettes.front,
    silhouettes.back,
  );
  const metricLateral = weightedMetricProfile(
    silhouettes.right,
    silhouettes.left,
  );
  const lateralCenter = weightedCenterProfile(
    silhouettes.right,
    silhouettes.left,
  );
  const hasMetricTarget = Boolean(metricFrontal && metricLateral);

  const chestRing = findLandmark(frontal, 0.23, 0.37, "max");
  const waistRing = findLandmark(frontal, 0.36, 0.5, "min");
  const hipsRing = findLandmark(frontal, 0.46, 0.61, "max");

  const radiusX = frontal.map((value, index) =>
    Math.max(
      0.65,
      metricFrontal
        ? (metricFrontal[index] ?? value * measurements.heightCm) / 2
        : (value * measurements.heightCm) / 2,
    ),
  );
  const radiusZ = lateral.map((value, index) =>
    Math.max(
      0.65,
      metricLateral
        ? (metricLateral[index] ?? value * measurements.heightCm) / 2
        : (value * measurements.heightCm) / 2,
    ),
  );
  const centerZ = lateral.map((_, index) => {
    const raw =
      (lateralCenter?.[index] ?? 0) * measurements.heightCm;
    return clamp(
      raw,
      -radiusZ[index] * 0.38,
      radiusZ[index] * 0.38,
    );
  });

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
    shoulderRing: clamp(Math.round(sampleCount * 0.18), 1, sampleCount - 4),
    crotchRing: clamp(Math.round(sampleCount * 0.63), 4, sampleCount - 2),
  };

  const meshVersion: 2 | 3 | 4 =
    hasMetricTarget && lateralCenter
      ? 4
      : hasMetricTarget
        ? 3
        : 2;
  const mesh = buildAnatomicalMesh(
    radiusX,
    radiusZ,
    centerZ,
    measurements,
    landmarks,
    meshVersion,
  );
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
  const viewCalibration = Object.fromEntries(
    (Object.entries(silhouettes) as Array<[BodySide, BodySilhouette]>)
      .filter(([, view]) => Boolean(view.viewCalibration))
      .map(([side, view]) => [side, view.viewCalibration]),
  ) as BodyCalibration["viewCalibration"];
  const metricCalibrationScores = views
    .map((view) => view.viewCalibration?.score)
    .filter((score): score is number => typeof score === "number");

  if (views.some((view) => view.confidence < 0.5)) {
    warnings.push("Uma das fotos tem separação fraca entre corpo e fundo.");
  }
  if (frontBackDifference > 0.075) {
    warnings.push("Frente e costas estão com escala ou pose diferentes.");
  }
  if (sideDifference > 0.065) {
    warnings.push("As duas laterais estão com escala ou pose diferentes.");
  }
  if (metricCalibrationScores.length > 0 && metricCalibrationScores.length < 4) {
    warnings.push("O alvo métrico não foi reconhecido nas quatro vistas; a escala métrica completa não foi ativada.");
  }
  if (
    metricCalibrationScores.some((metricScore) => metricScore < 0.68)
  ) {
    warnings.push("Uma vista detectou o alvo com muita perspectiva; fotografe o cartão no mesmo plano do corpo.");
  }
  if (score < 0.58) {
    warnings.push("Refaça as fotos com corpo inteiro, fundo contrastante e câmera na mesma altura.");
  }

  return {
    version: hasMetricTarget ? 3 : 2,
    method: hasMetricTarget
      ? "metric-target-anatomical-v3"
      : "weak-perspective-anatomical-primitives-v2",
    sampleCount,
    silhouettes,
    mesh,
    viewCalibration,
    quality: {
      score,
      frontBackDifference,
      sideDifference,
      warnings,
    },
    createdAt: new Date().toISOString(),
  };
}
