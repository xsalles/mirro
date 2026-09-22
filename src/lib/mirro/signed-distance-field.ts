import type {
  BodySignedDistanceField,
} from "./types";

const INF = 1e18;

function edt1d(
  source: Float64Array,
  step: number,
): Float64Array {
  const n = source.length;
  const distance = new Float64Array(n);
  if (n === 0) return distance;

  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;

  const coordinate = (index: number) => index * step;

  for (let q = 1; q < n; q += 1) {
    const qx = coordinate(q);
    let s = 0;

    while (true) {
      const vk = v[k];
      const vx = coordinate(vk);
      const denominator = 2 * (qx - vx);
      s =
        denominator === 0
          ? Infinity
          : (source[q] +
              qx * qx -
              source[vk] -
              vx * vx) /
            denominator;

      if (s > z[k] || k === 0) break;
      k -= 1;
    }

    if (s <= z[k] && k === 0) {
      v[0] = q;
      z[0] = -Infinity;
      z[1] = Infinity;
      continue;
    }

    k += 1;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }

  k = 0;
  for (let q = 0; q < n; q += 1) {
    const qx = coordinate(q);
    while (z[k + 1] < qx) k += 1;
    const vx = coordinate(v[k]);
    const delta = qx - vx;
    distance[q] =
      delta * delta + source[v[k]];
  }

  return distance;
}

function edt3d(params: {
  features: Uint8Array;
  nx: number;
  ny: number;
  nz: number;
  step: [number, number, number];
}) {
  const { features, nx, ny, nz, step } = params;
  const total = nx * ny * nz;
  let field = new Float64Array(total);

  for (let index = 0; index < total; index += 1) {
    field[index] = features[index] ? 0 : INF;
  }

  const indexOf = (x: number, y: number, z: number) =>
    (y * nz + z) * nx + x;

  for (let y = 0; y < ny; y += 1) {
    for (let z = 0; z < nz; z += 1) {
      const line = new Float64Array(nx);
      for (let x = 0; x < nx; x += 1) {
        line[x] = field[indexOf(x, y, z)];
      }
      const solved = edt1d(line, step[0]);
      for (let x = 0; x < nx; x += 1) {
        field[indexOf(x, y, z)] = solved[x];
      }
    }
  }

  for (let y = 0; y < ny; y += 1) {
    for (let x = 0; x < nx; x += 1) {
      const line = new Float64Array(nz);
      for (let z = 0; z < nz; z += 1) {
        line[z] = field[indexOf(x, y, z)];
      }
      const solved = edt1d(line, step[2]);
      for (let z = 0; z < nz; z += 1) {
        field[indexOf(x, y, z)] = solved[z];
      }
    }
  }

  for (let z = 0; z < nz; z += 1) {
    for (let x = 0; x < nx; x += 1) {
      const line = new Float64Array(ny);
      for (let y = 0; y < ny; y += 1) {
        line[y] = field[indexOf(x, y, z)];
      }
      const solved = edt1d(line, step[1]);
      for (let y = 0; y < ny; y += 1) {
        field[indexOf(x, y, z)] = solved[y];
      }
    }
  }

  return field;
}

export function buildSignedDistanceField(params: {
  occupancy: Uint8Array;
  resolution: {
    x: number;
    y: number;
    z: number;
  };
  originCm: [number, number, number];
  stepCm: [number, number, number];
  maxDistanceCm?: number;
  quantizationCm?: number;
}): BodySignedDistanceField {
  const { occupancy, resolution, originCm, stepCm } = params;
  const total =
    resolution.x * resolution.y * resolution.z;
  if (occupancy.length !== total) {
    throw new Error("Volume de ocupação incompatível com a grade SDF.");
  }

  const empty = new Uint8Array(total);
  for (let index = 0; index < total; index += 1) {
    empty[index] = occupancy[index] ? 0 : 1;
  }

  const distanceToBodySquared = edt3d({
    features: occupancy,
    nx: resolution.x,
    ny: resolution.y,
    nz: resolution.z,
    step: stepCm,
  });
  const distanceToEmptySquared = edt3d({
    features: empty,
    nx: resolution.x,
    ny: resolution.y,
    nz: resolution.z,
    step: stepCm,
  });

  const quantizationCm = params.quantizationCm ?? 0.05;
  const maxDistanceCm = params.maxDistanceCm ?? 40;
  const maxQuantized = Math.min(
    32767,
    Math.floor(maxDistanceCm / quantizationCm),
  );
  const values = new Int16Array(total);

  for (let index = 0; index < total; index += 1) {
    const distance = Math.sqrt(
      occupancy[index]
        ? distanceToEmptySquared[index]
        : distanceToBodySquared[index],
    );
    const signed = occupancy[index] ? -distance : distance;
    const quantized = Math.round(signed / quantizationCm);
    values[index] = Math.max(
      -maxQuantized,
      Math.min(maxQuantized, quantized),
    );
  }

  return {
    version: 1,
    method: "exact-edt-sdf-v1",
    resolution: { ...resolution },
    originCm: [...originCm],
    stepCm: [...stepCm],
    quantizationCm,
    maxDistanceCm,
    values,
  };
}

export function signedDistanceAtGrid(
  sdf: BodySignedDistanceField,
  x: number,
  y: number,
  z: number,
) {
  if (
    x < 0 ||
    y < 0 ||
    z < 0 ||
    x >= sdf.resolution.x ||
    y >= sdf.resolution.y ||
    z >= sdf.resolution.z
  ) {
    return sdf.maxDistanceCm;
  }
  const index =
    (y * sdf.resolution.z + z) *
      sdf.resolution.x +
    x;
  return sdf.values[index] * sdf.quantizationCm;
}

function trilinear(
  sdf: BodySignedDistanceField,
  gx: number,
  gy: number,
  gz: number,
) {
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const z0 = Math.floor(gz);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const z1 = z0 + 1;
  const tx = gx - x0;
  const ty = gy - y0;
  const tz = gz - z0;

  const sample = (x: number, y: number, z: number) =>
    signedDistanceAtGrid(sdf, x, y, z);
  const lerp = (a: number, b: number, t: number) =>
    a + (b - a) * t;

  const c000 = sample(x0, y0, z0);
  const c100 = sample(x1, y0, z0);
  const c010 = sample(x0, y1, z0);
  const c110 = sample(x1, y1, z0);
  const c001 = sample(x0, y0, z1);
  const c101 = sample(x1, y0, z1);
  const c011 = sample(x0, y1, z1);
  const c111 = sample(x1, y1, z1);

  const c00 = lerp(c000, c100, tx);
  const c10 = lerp(c010, c110, tx);
  const c01 = lerp(c001, c101, tx);
  const c11 = lerp(c011, c111, tx);
  const c0 = lerp(c00, c10, ty);
  const c1 = lerp(c01, c11, ty);
  return lerp(c0, c1, tz);
}

export function sampleSignedDistance(
  sdf: BodySignedDistanceField,
  x: number,
  y: number,
  z: number,
) {
  const gx = (x - sdf.originCm[0]) / sdf.stepCm[0];
  const gy = (y - sdf.originCm[1]) / sdf.stepCm[1];
  const gz = (z - sdf.originCm[2]) / sdf.stepCm[2];

  if (
    gx < -1 ||
    gy < -1 ||
    gz < -1 ||
    gx > sdf.resolution.x ||
    gy > sdf.resolution.y ||
    gz > sdf.resolution.z
  ) {
    return sdf.maxDistanceCm;
  }
  return trilinear(sdf, gx, gy, gz);
}

export function sampleSignedDistanceGradient(
  sdf: BodySignedDistanceField,
  x: number,
  y: number,
  z: number,
): [number, number, number] {
  const ex = Math.max(0.2, sdf.stepCm[0] * 0.55);
  const ey = Math.max(0.2, sdf.stepCm[1] * 0.55);
  const ez = Math.max(0.2, sdf.stepCm[2] * 0.55);

  const dx =
    (sampleSignedDistance(sdf, x + ex, y, z) -
      sampleSignedDistance(sdf, x - ex, y, z)) /
    (2 * ex);
  const dy =
    (sampleSignedDistance(sdf, x, y + ey, z) -
      sampleSignedDistance(sdf, x, y - ey, z)) /
    (2 * ey);
  const dz =
    (sampleSignedDistance(sdf, x, y, z + ez) -
      sampleSignedDistance(sdf, x, y, z - ez)) /
    (2 * ez);
  const length = Math.hypot(dx, dy, dz);

  if (length < 1e-7) return [0, 0, 0];
  return [dx / length, dy / length, dz / length];
}
