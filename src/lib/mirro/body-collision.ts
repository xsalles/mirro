import type { BodyMesh } from "./types";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function ringRadii(mesh: BodyMesh, ring: number) {
  const safeRing = clamp(ring, 0, mesh.ringCount - 1);
  const first = safeRing * mesh.segmentsPerRing * 3;
  const quarter = (safeRing * mesh.segmentsPerRing + Math.floor(mesh.segmentsPerRing / 4)) * 3;
  return {
    radiusX: Math.max(0.65, Math.abs(mesh.vertices[first])),
    radiusZ: Math.max(0.65, Math.abs(mesh.vertices[quarter + 2])),
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

export function projectParticleOutsideBody(
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

export function pointInsideExpandedBody(
  mesh: BodyMesh,
  x: number,
  y: number,
  z: number,
  thicknessCm = 0,
) {
  const section = getBodySectionAtY(mesh, y);
  if (!section.insideHeight) return false;
  const rx = section.radiusX + thicknessCm;
  const rz = section.radiusZ + thicknessCm;
  return (x * x) / (rx * rx) + (z * z) / (rz * rz) < 1;
}
