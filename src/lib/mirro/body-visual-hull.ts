import { buildSignedDistanceField } from "./signed-distance-field";
import {
  BODY_VIEW_ANGLE_DEG,
  BODY_VIEW_ANGLE_RAD,
  BODY_VIEW_SEQUENCE,
} from "./body-views";
import type {
  BodyMesh,
  BodySilhouette,
  BodyViewId,
  BodyVisualHull,
} from "./types";

type Vec3 = [number, number, number];

type ViewMask = {
  mask: Uint8Array;
  width: number;
  height: number;
};

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

function meshBounds(mesh: BodyMesh) {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (let i = 0; i < mesh.vertices.length; i += 3) {
    minX = Math.min(minX, mesh.vertices[i]);
    minY = Math.min(minY, mesh.vertices[i + 1]);
    minZ = Math.min(minZ, mesh.vertices[i + 2]);
    maxX = Math.max(maxX, mesh.vertices[i]);
    maxY = Math.max(maxY, mesh.vertices[i + 1]);
    maxZ = Math.max(maxZ, mesh.vertices[i + 2]);
  }

  return {
    minX,
    minY,
    minZ,
    maxX,
    maxY,
    maxZ,
  };
}

function rowExtent(
  view: ViewMask,
  silhouette: BodySilhouette,
  t: number,
) {
  const y = clamp(
    Math.round(
      silhouette.bounds.y +
        clamp(t, 0, 1) *
          Math.max(1, silhouette.bounds.height - 1),
    ),
    0,
    view.height - 1,
  );

  for (let offset = 0; offset <= 3; offset += 1) {
    for (const direction of offset === 0 ? [0] : [-1, 1]) {
      const row = y + offset * direction;
      if (row < 0 || row >= view.height) continue;
      let minX = view.width;
      let maxX = -1;

      for (
        let x = Math.max(0, silhouette.bounds.x - 2);
        x <
        Math.min(
          view.width,
          silhouette.bounds.x + silhouette.bounds.width + 2,
        );
        x += 1
      ) {
        if (!view.mask[row * view.width + x]) continue;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
      }

      if (maxX >= minX) {
        return {
          y: row,
          minX,
          maxX,
          centerX: (minX + maxX) / 2,
          spanPx: Math.max(1, maxX - minX + 1),
        };
      }
    }
  }

  return null;
}

function maskContains(
  view: ViewMask,
  x: number,
  y: number,
  radius = 1,
) {
  const cx = Math.round(x);
  const cy = Math.round(y);

  for (let dy = -radius; dy <= radius; dy += 1) {
    const py = cy + dy;
    if (py < 0 || py >= view.height) continue;
    for (let dx = -radius; dx <= radius; dx += 1) {
      const px = cx + dx;
      if (px < 0 || px >= view.width) continue;
      if (view.mask[py * view.width + px]) return true;
    }
  }
  return false;
}

function horizontalCoordinate(
  view: BodyViewId,
  x: number,
  z: number,
) {
  const angle = BODY_VIEW_ANGLE_RAD[view];
  return x * Math.cos(angle) - z * Math.sin(angle);
}

function metricSpanAt(
  silhouette: BodySilhouette,
  t: number,
  fallbackHeightCm: number,
) {
  const metric = sampleProfile(
    silhouette.metricWidthProfileCm,
    t,
  );
  if (metric > 0.5) return metric;
  return Math.max(
    1,
    sampleProfile(silhouette.widthProfile, t) *
      fallbackHeightCm,
  );
}

function encodeRle(values: Uint8Array): {
  start: 0 | 1;
  runs: number[];
} {
  if (!values.length) return { start: 0, runs: [] };
  const runs: number[] = [];
  let current = values[0] as 0 | 1;
  let length = 1;

  for (let index = 1; index < values.length; index += 1) {
    if (values[index] === current) {
      length += 1;
    } else {
      runs.push(length);
      current = values[index] as 0 | 1;
      length = 1;
    }
  }
  runs.push(length);
  return {
    start: values[0] as 0 | 1,
    runs,
  };
}

function computeNormals(
  vertices: number[],
  indices: number[],
) {
  const normals = new Array<number>(vertices.length).fill(0);

  for (let offset = 0; offset < indices.length; offset += 3) {
    const ia = indices[offset];
    const ib = indices[offset + 1];
    const ic = indices[offset + 2];
    const a = ia * 3;
    const b = ib * 3;
    const c = ic * 3;

    const abx = vertices[b] - vertices[a];
    const aby = vertices[b + 1] - vertices[a + 1];
    const abz = vertices[b + 2] - vertices[a + 2];
    const acx = vertices[c] - vertices[a];
    const acy = vertices[c + 1] - vertices[a + 1];
    const acz = vertices[c + 2] - vertices[a + 2];

    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;

    for (const index of [a, b, c]) {
      normals[index] += nx;
      normals[index + 1] += ny;
      normals[index + 2] += nz;
    }
  }

  for (let index = 0; index < normals.length; index += 3) {
    const length =
      Math.hypot(
        normals[index],
        normals[index + 1],
        normals[index + 2],
      ) || 1;
    normals[index] /= length;
    normals[index + 1] /= length;
    normals[index + 2] /= length;
  }

  return normals;
}

function smoothVertices(
  vertices: number[],
  indices: number[],
  iterations = 2,
) {
  const vertexCount = vertices.length / 3;
  const neighbors = Array.from(
    { length: vertexCount },
    () => new Set<number>(),
  );

  for (let offset = 0; offset < indices.length; offset += 3) {
    const triangle = [
      indices[offset],
      indices[offset + 1],
      indices[offset + 2],
    ];
    for (let i = 0; i < 3; i += 1) {
      const a = triangle[i];
      const b = triangle[(i + 1) % 3];
      neighbors[a].add(b);
      neighbors[b].add(a);
    }
  }

  let current = [...vertices];

  const pass = (lambda: number) => {
    const next = [...current];
    for (let vertex = 0; vertex < vertexCount; vertex += 1) {
      const adjacent = neighbors[vertex];
      if (adjacent.size < 3) continue;
      let x = 0;
      let y = 0;
      let z = 0;
      for (const neighbor of adjacent) {
        x += current[neighbor * 3];
        y += current[neighbor * 3 + 1];
        z += current[neighbor * 3 + 2];
      }
      const inverse = 1 / adjacent.size;
      const offset = vertex * 3;
      next[offset] +=
        (x * inverse - current[offset]) * lambda;
      next[offset + 1] +=
        (y * inverse - current[offset + 1]) * lambda;
      next[offset + 2] +=
        (z * inverse - current[offset + 2]) * lambda;
    }
    current = next;
  };

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    pass(0.31);
    pass(-0.325);
  }

  return current;
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

function extractSurface(params: {
  occupancy: Uint8Array;
  nx: number;
  ny: number;
  nz: number;
  origin: Vec3;
  step: Vec3;
}) {
  const {
    occupancy,
    nx,
    ny,
    nz,
    origin,
    step,
  } = params;
  const vertices: number[] = [];
  const indices: number[] = [];
  const edgeMap = new Map<string, number>();

  const gridIndex = (x: number, y: number, z: number) =>
    (y * nz + z) * nx + x;

  const gridPoint = (
    x: number,
    y: number,
    z: number,
  ): Vec3 => [
    origin[0] + x * step[0],
    origin[1] + y * step[1],
    origin[2] + z * step[2],
  ];

  const edgeVertex = (
    aIndex: number,
    bIndex: number,
    a: Vec3,
    b: Vec3,
  ) => {
    const key =
      aIndex < bIndex
        ? `${aIndex}:${bIndex}`
        : `${bIndex}:${aIndex}`;
    const existing = edgeMap.get(key);
    if (existing !== undefined) return existing;
    const index = vertices.length / 3;
    vertices.push(
      (a[0] + b[0]) / 2,
      (a[1] + b[1]) / 2,
      (a[2] + b[2]) / 2,
    );
    edgeMap.set(key, index);
    return index;
  };

  const addTriangle = (
    a: number,
    b: number,
    c: number,
    referenceInside: Vec3,
  ) => {
    const ao = a * 3;
    const bo = b * 3;
    const co = c * 3;
    const ax = vertices[ao];
    const ay = vertices[ao + 1];
    const az = vertices[ao + 2];
    const bx = vertices[bo];
    const by = vertices[bo + 1];
    const bz = vertices[bo + 2];
    const cx = vertices[co];
    const cy = vertices[co + 1];
    const cz = vertices[co + 2];
    const ab: Vec3 = [bx - ax, by - ay, bz - az];
    const ac: Vec3 = [cx - ax, cy - ay, cz - az];
    const normal: Vec3 = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ];
    const centroid: Vec3 = [
      (ax + bx + cx) / 3,
      (ay + by + cy) / 3,
      (az + bz + cz) / 3,
    ];
    const outward: Vec3 = [
      centroid[0] - referenceInside[0],
      centroid[1] - referenceInside[1],
      centroid[2] - referenceInside[2],
    ];
    const alignment =
      normal[0] * outward[0] +
      normal[1] * outward[1] +
      normal[2] * outward[2];

    if (alignment < 0) indices.push(a, c, b);
    else indices.push(a, b, c);
  };

  for (let y = 0; y < ny - 1; y += 1) {
    for (let z = 0; z < nz - 1; z += 1) {
      for (let x = 0; x < nx - 1; x += 1) {
        const cornerIndices = CUBE_OFFSETS.map(
          ([dx, dy, dz]) =>
            gridIndex(x + dx, y + dy, z + dz),
        );
        const cornerPoints = CUBE_OFFSETS.map(
          ([dx, dy, dz]) =>
            gridPoint(x + dx, y + dy, z + dz),
        );

        for (const tetra of TETRAHEDRA) {
          const inside = tetra.filter(
            (corner) => occupancy[cornerIndices[corner]],
          );
          if (inside.length === 0 || inside.length === 4) {
            continue;
          }
          const outside = tetra.filter(
            (corner) => !occupancy[cornerIndices[corner]],
          );

          const midpointIndex = (a: number, b: number) =>
            edgeVertex(
              cornerIndices[a],
              cornerIndices[b],
              cornerPoints[a],
              cornerPoints[b],
            );

          const insideReference: Vec3 = [
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
            const a = midpointIndex(i, outside[0]);
            const b = midpointIndex(i, outside[1]);
            const c = midpointIndex(i, outside[2]);
            addTriangle(a, b, c, insideReference);
            continue;
          }

          if (inside.length === 3) {
            const o = outside[0];
            const a = midpointIndex(o, inside[0]);
            const b = midpointIndex(o, inside[1]);
            const c = midpointIndex(o, inside[2]);
            addTriangle(a, c, b, insideReference);
            continue;
          }

          const i0 = inside[0];
          const i1 = inside[1];
          const o0 = outside[0];
          const o1 = outside[1];
          const a = midpointIndex(i0, o0);
          const b = midpointIndex(i0, o1);
          const c = midpointIndex(i1, o1);
          const d = midpointIndex(i1, o0);
          addTriangle(a, b, c, insideReference);
          addTriangle(a, c, d, insideReference);
        }
      }
    }
  }

  const smoothed = smoothVertices(vertices, indices, 2);
  return {
    vertices: smoothed,
    normals: computeNormals(smoothed, indices),
    indices,
  };
}

export function buildBodyVisualHull(params: {
  views: Partial<Record<BodyViewId, ViewMask>>;
  silhouettes: Partial<Record<BodyViewId, BodySilhouette>>;
  baseMesh: BodyMesh;
  bodyHeightCm: number;
}): BodyVisualHull {
  const activeViews = BODY_VIEW_SEQUENCE.filter(
    (view) => params.views[view] && params.silhouettes[view],
  );
  if (activeViews.length < 4) {
    throw new Error(
      "O visual hull precisa de pelo menos quatro vistas válidas.",
    );
  }
  const bounds = meshBounds(params.baseMesh);
  const margin = Math.max(1.5, params.bodyHeightCm * 0.009);
  const origin: Vec3 = [
    bounds.minX - margin,
    bounds.minY - margin,
    bounds.minZ - margin,
  ];
  const max: Vec3 = [
    bounds.maxX + margin,
    bounds.maxY + margin,
    bounds.maxZ + margin,
  ];
  const width = max[0] - origin[0];
  const height = max[1] - origin[1];
  const depth = max[2] - origin[2];
  const targetVoxel = clamp(
    params.bodyHeightCm / 88,
    1.45,
    2.35,
  );
  const nx = clamp(Math.round(width / targetVoxel) + 1, 26, 52);
  const ny = clamp(Math.round(height / targetVoxel) + 1, 68, 100);
  const nz = clamp(Math.round(depth / targetVoxel) + 1, 22, 46);
  const step: Vec3 = [
    width / Math.max(1, nx - 1),
    height / Math.max(1, ny - 1),
    depth / Math.max(1, nz - 1),
  ];
  const occupancy = new Uint8Array(nx * ny * nz);
  const rowCache = Object.fromEntries(
    activeViews.map((view) => [
      view,
      Array.from({ length: ny }, (_, y) => {
        const worldY = origin[1] + y * step[1];
        const t = clamp(
          (max[1] - worldY) / Math.max(1e-6, height),
          0,
          1,
        );
        return {
          t,
          extent: rowExtent(
            params.views[view]!,
            params.silhouettes[view]!,
            t,
          ),
          metricSpan: metricSpanAt(
            params.silhouettes[view]!,
            t,
            params.bodyHeightCm,
          ),
        };
      }),
    ]),
  ) as Record<
    BodyViewId,
    Array<{
      t: number;
      extent: ReturnType<typeof rowExtent>;
      metricSpan: number;
    }>
  >;

  let occupiedVoxelCount = 0;

  for (let y = 0; y < ny; y += 1) {
    for (let z = 0; z < nz; z += 1) {
      const worldZ = origin[2] + z * step[2];
      for (let x = 0; x < nx; x += 1) {
        const worldX = origin[0] + x * step[0];
        let inside = true;

        for (const view of activeViews) {
          const row = rowCache[view][y];
          if (!row.extent || row.metricSpan <= 0) {
            inside = false;
            break;
          }
          const h = horizontalCoordinate(
            view,
            worldX,
            worldZ,
          );
          const pixelX =
            row.extent.centerX +
            (h / row.metricSpan) * row.extent.spanPx;

          if (
            !maskContains(
              params.views[view]!,
              pixelX,
              row.extent.y,
              1,
            )
          ) {
            inside = false;
            break;
          }
        }

        if (!inside) continue;
        const index = (y * nz + z) * nx + x;
        occupancy[index] = 1;
        occupiedVoxelCount += 1;
      }
    }
  }

  if (occupiedVoxelCount < 80) {
    throw new Error(
      "O visual hull ficou vazio ou instável. Mantenha o celular fixo e gire o corpo no mesmo ponto entre as vistas.",
    );
  }

  const surface = extractSurface({
    occupancy,
    nx,
    ny,
    nz,
    origin,
    step,
  });

  if (surface.indices.length < 300) {
    throw new Error(
      "A superfície densa não teve triângulos suficientes para ser confiável.",
    );
  }

  const resolution = { x: nx, y: ny, z: nz };
  const signedDistanceField = buildSignedDistanceField({
    occupancy,
    resolution,
    originCm: origin,
    stepCm: step,
    maxDistanceCm: Math.max(30, params.bodyHeightCm * 0.22),
  });
  const isEightView = activeViews.length >= 8;

  return {
    version: isEightView ? 2 : 1,
    method: isEightView
      ? "eight-view-turntable-marching-tetrahedra-v2"
      : "four-view-turntable-marching-tetrahedra-v1",
    captureMode: "fixed-camera-person-turntable",
    resolution,
    boundsCm: {
      width,
      height,
      depth,
    },
    originCm: origin,
    gridStepCm: step,
    voxelSizeCm: (step[0] + step[1] + step[2]) / 3,
    viewCount: isEightView ? 8 : 4,
    viewAnglesDeg: activeViews.map(
      (view) => BODY_VIEW_ANGLE_DEG[view],
    ),
    occupiedVoxelCount,
    occupancyRle: encodeRle(occupancy),
    vertices: surface.vertices,
    normals: surface.normals,
    indices: surface.indices,
    signedDistanceField,
  };
}
