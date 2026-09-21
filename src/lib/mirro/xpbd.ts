import { projectParticleOutsideBody } from "./body-collision";
import type {
  BodyMesh,
  ClothConstraintKind,
  ClothMaterial,
  ClothSimulationStats,
  GarmentMesh,
} from "./types";

function complianceFor(kind: ClothConstraintKind, material: ClothMaterial) {
  if (kind === "structural") return material.stretchCompliance;
  if (kind === "shear") return material.shearCompliance;
  if (kind === "bend") return material.bendCompliance;
  return material.seamCompliance;
}

function solveDistanceConstraint(
  mesh: GarmentMesh,
  constraintIndex: number,
  material: ClothMaterial,
  dt: number,
) {
  const constraint = mesh.constraints[constraintIndex];
  const a = constraint.a;
  const b = constraint.b;
  const ao = a * 3;
  const bo = b * 3;
  const dx = mesh.positions[bo] - mesh.positions[ao];
  const dy = mesh.positions[bo + 1] - mesh.positions[ao + 1];
  const dz = mesh.positions[bo + 2] - mesh.positions[ao + 2];
  const length = Math.hypot(dx, dy, dz);
  if (length < 1e-7) return;

  const wa = mesh.inverseMass[a];
  const wb = mesh.inverseMass[b];
  const alpha = complianceFor(constraint.kind, material) / (dt * dt);
  const denominator = wa + wb + alpha;
  if (denominator <= 0) return;

  const c = length - constraint.restLength;
  const deltaLambda = (-c - alpha * constraint.lambda) / denominator;
  constraint.lambda += deltaLambda;

  const nx = dx / length;
  const ny = dy / length;
  const nz = dz / length;

  if (wa > 0) {
    mesh.positions[ao] -= wa * deltaLambda * nx;
    mesh.positions[ao + 1] -= wa * deltaLambda * ny;
    mesh.positions[ao + 2] -= wa * deltaLambda * nz;
  }
  if (wb > 0) {
    mesh.positions[bo] += wb * deltaLambda * nx;
    mesh.positions[bo + 1] += wb * deltaLambda * ny;
    mesh.positions[bo + 2] += wb * deltaLambda * nz;
  }
}

function integrate(mesh: GarmentMesh, material: ClothMaterial, dt: number) {
  const dt2 = dt * dt;
  let maxDisplacementCm = 0;

  for (let particle = 0; particle < mesh.inverseMass.length; particle += 1) {
    if (mesh.inverseMass[particle] <= 0) continue;
    const offset = particle * 3;
    const x = mesh.positions[offset];
    const y = mesh.positions[offset + 1];
    const z = mesh.positions[offset + 2];
    const vx = (x - mesh.previousPositions[offset]) * material.damping;
    const vy = (y - mesh.previousPositions[offset + 1]) * material.damping;
    const vz = (z - mesh.previousPositions[offset + 2]) * material.damping;

    mesh.previousPositions[offset] = x;
    mesh.previousPositions[offset + 1] = y;
    mesh.previousPositions[offset + 2] = z;

    mesh.positions[offset] = x + vx;
    mesh.positions[offset + 1] = y + vy - material.gravityCmPerSec2 * dt2;
    mesh.positions[offset + 2] = z + vz;

    maxDisplacementCm = Math.max(
      maxDisplacementCm,
      Math.hypot(
        mesh.positions[offset] - x,
        mesh.positions[offset + 1] - y,
        mesh.positions[offset + 2] - z,
      ),
    );
  }

  return maxDisplacementCm;
}

function applyFrictionAfterCollision(
  mesh: GarmentMesh,
  particle: number,
  friction: number,
) {
  const offset = particle * 3;
  const factor = Math.min(0.9, Math.max(0, friction));
  mesh.previousPositions[offset] +=
    (mesh.positions[offset] - mesh.previousPositions[offset]) * factor;
  mesh.previousPositions[offset + 1] +=
    (mesh.positions[offset + 1] - mesh.previousPositions[offset + 1]) * factor;
  mesh.previousPositions[offset + 2] +=
    (mesh.positions[offset + 2] - mesh.previousPositions[offset + 2]) * factor;
}

export function simulateClothStep(params: {
  mesh: GarmentMesh;
  bodyMesh: BodyMesh;
  material: ClothMaterial;
  dt?: number;
  iterations?: number;
}): ClothSimulationStats {
  const {
    mesh,
    bodyMesh,
    material,
    dt = 1 / 60,
    iterations = 9,
  } = params;

  const maxDisplacementCm = integrate(mesh, material, dt);
  for (const constraint of mesh.constraints) constraint.lambda = 0;

  let collisions = 0;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    for (let index = 0; index < mesh.constraints.length; index += 1) {
      solveDistanceConstraint(mesh, index, material, dt);
    }

    for (let particle = 0; particle < mesh.inverseMass.length; particle += 1) {
      if (mesh.inverseMass[particle] <= 0) continue;
      if (
        projectParticleOutsideBody(
          bodyMesh,
          mesh.positions,
          particle,
          material.thicknessCm,
        )
      ) {
        collisions += 1;
        applyFrictionAfterCollision(mesh, particle, material.friction);
      }
    }
  }

  return {
    steps: 1,
    collisions,
    maxDisplacementCm,
  };
}

export function simulateCloth(params: {
  mesh: GarmentMesh;
  bodyMesh: BodyMesh;
  material: ClothMaterial;
  steps: number;
  dt?: number;
  iterations?: number;
}): ClothSimulationStats {
  let collisions = 0;
  let maxDisplacementCm = 0;

  for (let step = 0; step < params.steps; step += 1) {
    const result = simulateClothStep({
      mesh: params.mesh,
      bodyMesh: params.bodyMesh,
      material: params.material,
      dt: params.dt,
      iterations: params.iterations,
    });
    collisions += result.collisions;
    maxDisplacementCm = Math.max(maxDisplacementCm, result.maxDisplacementCm);
  }

  return {
    steps: params.steps,
    collisions,
    maxDisplacementCm,
  };
}
