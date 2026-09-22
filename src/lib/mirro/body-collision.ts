import type { BodyCollisionPrimitive, BodyMesh } from "./types";

type Vec3 = [number, number, number];

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function ringRadii(mesh: BodyMesh, ring: number) {
  const safeRing = clamp(ring, 0, mesh.ringCount - 1);

  if (mesh.radiusXProfile && mesh.radiusZProfile) {
    return {
      radiusX: Math.max(0.65, mesh.radiusXProfile[safeRing] ?? 0.65),
      radiusZ: Math.max(0.65, mesh.radiusZProfile[safeRing] ?? 0.65),
    };
  }

  const first = safeRing * mesh.segmentsPerRing * 3;
  const quarter =
    (safeRing * mesh.segmentsPerRing + Math.floor(mesh.segmentsPerRing / 4)) * 3;
  return {
    radiusX: Math.max(0.65, Math.abs(mesh.vertices[first] ?? 0.65)),
    radiusZ: Math.max(0.65, Math.abs(mesh.vertices[quarter + 2] ?? 0.65)),
  };
}

export function bodyRingY(mesh: BodyMesh, ring: number) {
  const t = clamp(ring, 0, mesh.ringCount - 1) / Math.max(1, mesh.ringCount - 1);
  return mesh.boundsCm.height / 2 - t * mesh.boundsCm.height;
}

export function getBodySectionAtY(mesh: BodyMesh, y: number) {
  const halfHeight = mesh.boundsCm.height / 2;
  const t = clamp((halfHeight - y) / mesh.boundsCm.height, 0, 1);
  const ringFloat = t * (mesh.ringCount - 1);
  const lower = Math.floor(ringFloat);
  const upper = Math.min(mesh.ringCount - 1, lower + 1);
  const mix = ringFloat - lower;
  const a = ringRadii(mesh, lower);
  const b = ringRadii(mesh, upper);

  return {
    radiusX: a.radiusX + (b.radiusX - a.radiusX) * mix,
    radiusZ: a.radiusZ + (b.radiusZ - a.radiusZ) * mix,
    insideHeight: y >= -halfHeight && y <= halfHeight,
  };
}

function interpolateProfile(values: number[], t: number) {
  if (!values.length) return 0.65;
  const position = clamp(t, 0, 1) * (values.length - 1);
  const low = Math.floor(position);
  const high = Math.min(values.length - 1, low + 1);
  const mix = position - low;
  return (values[low] ?? 0.65) + ((values[high] ?? 0.65) - (values[low] ?? 0.65)) * mix;
}

function closestPointOnSegment(point: Vec3, start: Vec3, end: Vec3) {
  const ab: Vec3 = [
    end[0] - start[0],
    end[1] - start[1],
    end[2] - start[2],
  ];
  const ap: Vec3 = [
    point[0] - start[0],
    point[1] - start[1],
    point[2] - start[2],
  ];
  const denominator = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
  const t =
    denominator <= 1e-8
      ? 0
      : clamp(
          (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / denominator,
          0,
          1,
        );

  return {
    t,
    point: [
      start[0] + ab[0] * t,
      start[1] + ab[1] * t,
      start[2] + ab[2] * t,
    ] as Vec3,
  };
}

function pointInsidePrimitive(
  primitive: BodyCollisionPrimitive,
  x: number,
  y: number,
  z: number,
  thicknessCm: number,
) {
  if (primitive.type === "ellipsoid") {
    const rx = primitive.radii[0] + thicknessCm;
    const ry = primitive.radii[1] + thicknessCm;
    const rz = primitive.radii[2] + thicknessCm;
    const nx = (x - primitive.center[0]) / rx;
    const ny = (y - primitive.center[1]) / ry;
    const nz = (z - primitive.center[2]) / rz;
    return nx * nx + ny * ny + nz * nz < 1;
  }

  if (primitive.type === "tapered-capsule") {
    const closest = closestPointOnSegment(
      [x, y, z],
      primitive.start,
      primitive.end,
    );
    const radius =
      primitive.startRadius +
      (primitive.endRadius - primitive.startRadius) * closest.t +
      thicknessCm;
    return (
      Math.hypot(
        x - closest.point[0],
        y - closest.point[1],
        z - closest.point[2],
      ) < radius
    );
  }

  if (y > primitive.topY || y < primitive.bottomY) return false;
  const t =
    (primitive.topY - y) /
    Math.max(1e-6, primitive.topY - primitive.bottomY);
  const rx = interpolateProfile(primitive.radiusX, t) + thicknessCm;
  const rz = interpolateProfile(primitive.radiusZ, t) + thicknessCm;
  return (x * x) / (rx * rx) + (z * z) / (rz * rz) < 1;
}

function projectAgainstPrimitive(
  primitive: BodyCollisionPrimitive,
  positions: number[],
  particleIndex: number,
  thicknessCm: number,
) {
  const offset = particleIndex * 3;
  const x = positions[offset];
  const y = positions[offset + 1];
  const z = positions[offset + 2];

  if (primitive.type === "ellipsoid") {
    const rx = primitive.radii[0] + thicknessCm;
    const ry = primitive.radii[1] + thicknessCm;
    const rz = primitive.radii[2] + thicknessCm;
    const dx = x - primitive.center[0];
    const dy = y - primitive.center[1];
    const dz = z - primitive.center[2];
    const q =
      (dx * dx) / (rx * rx) +
      (dy * dy) / (ry * ry) +
      (dz * dz) / (rz * rz);
    if (q >= 1) return false;

    if (q < 1e-8) {
      positions[offset + 2] = primitive.center[2] + rz;
      return true;
    }

    const scale = 1 / Math.sqrt(q);
    positions[offset] = primitive.center[0] + dx * scale;
    positions[offset + 1] = primitive.center[1] + dy * scale;
    positions[offset + 2] = primitive.center[2] + dz * scale;
    return true;
  }

  if (primitive.type === "tapered-capsule") {
    const closest = closestPointOnSegment(
      [x, y, z],
      primitive.start,
      primitive.end,
    );
    const radius =
      primitive.startRadius +
      (primitive.endRadius - primitive.startRadius) * closest.t +
      thicknessCm;
    let dx = x - closest.point[0];
    let dy = y - closest.point[1];
    let dz = z - closest.point[2];
    let distance = Math.hypot(dx, dy, dz);
    if (distance >= radius) return false;

    if (distance < 1e-8) {
      dx = 0;
      dy = 0;
      dz = z < 0 ? -1 : 1;
      distance = 1;
    }

    const scale = radius / distance;
    positions[offset] = closest.point[0] + dx * scale;
    positions[offset + 1] = closest.point[1] + dy * scale;
    positions[offset + 2] = closest.point[2] + dz * scale;
    return true;
  }

  if (y > primitive.topY || y < primitive.bottomY) return false;
  const t =
    (primitive.topY - y) /
    Math.max(1e-6, primitive.topY - primitive.bottomY);
  const rx = interpolateProfile(primitive.radiusX, t) + thicknessCm;
  const rz = interpolateProfile(primitive.radiusZ, t) + thicknessCm;
  const q = (x * x) / (rx * rx) + (z * z) / (rz * rz);
  if (q >= 1) return false;

  if (q < 1e-8) {
    positions[offset + 2] = z < 0 ? -rz : rz;
    return true;
  }

  const scale = 1 / Math.sqrt(q);
  positions[offset] = x * scale;
  positions[offset + 2] = z * scale;
  return true;
}

function projectLegacyHull(
  mesh: BodyMesh,
  positions: number[],
  particleIndex: number,
  thicknessCm: number,
) {
  const offset = particleIndex * 3;
  const x = positions[offset];
  const y = positions[offset + 1];
  const z = positions[offset + 2];
  const section = getBodySectionAtY(mesh, y);
  if (!section.insideHeight) return false;

  const radiusX = section.radiusX + thicknessCm;
  const radiusZ = section.radiusZ + thicknessCm;
  const nx = x / radiusX;
  const nz = z / radiusZ;
  const ellipse = nx * nx + nz * nz;

  if (ellipse >= 1) return false;

  if (ellipse < 1e-8) {
    positions[offset + 2] = z < 0 ? -radiusZ : radiusZ;
    return true;
  }

  const scale = 1 / Math.sqrt(ellipse);
  positions[offset] = x * scale;
  positions[offset + 2] = z * scale;
  return true;
}

export function projectParticleOutsideBody(
  mesh: BodyMesh,
  positions: number[],
  particleIndex: number,
  thicknessCm: number,
) {
  if (!mesh.collisionPrimitives?.length) {
    return projectLegacyHull(mesh, positions, particleIndex, thicknessCm);
  }

  let collided = false;

  // Overlapping anatomical primitives meet at shoulders and hips.
  // Repeating the union projection prevents a particle from being pushed
  // out of one primitive directly into its neighbor.
  for (let pass = 0; pass < 3; pass += 1) {
    let changedThisPass = false;
    for (const primitive of mesh.collisionPrimitives) {
      if (
        projectAgainstPrimitive(
          primitive,
          positions,
          particleIndex,
          thicknessCm,
        )
      ) {
        collided = true;
        changedThisPass = true;
      }
    }
    if (!changedThisPass) break;
  }

  return collided;
}

export function pointInsideExpandedBody(
  mesh: BodyMesh,
  x: number,
  y: number,
  z: number,
  thicknessCm = 0,
) {
  if (mesh.collisionPrimitives?.length) {
    return mesh.collisionPrimitives.some((primitive) =>
      pointInsidePrimitive(primitive, x, y, z, thicknessCm),
    );
  }

  const section = getBodySectionAtY(mesh, y);
  if (!section.insideHeight) return false;
  const rx = section.radiusX + thicknessCm;
  const rz = section.radiusZ + thicknessCm;
  return (x * x) / (rx * rx) + (z * z) / (rz * rz) < 1;
}
