import { projectParticleOutsideBody } from "./body-collision";
import type {
  BodyMesh,
  ClothConstraintKind,
  ClothMaterial,
  ClothSimulationStats,
  GarmentMesh,
} from "./types";

const connectedPairCache = new WeakMap<GarmentMesh, Set<string>>();

function pairKey(a: number, b: number) {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function connectedPairs(mesh: GarmentMesh) {
  const cached = connectedPairCache.get(mesh);
  if (cached) return cached;

  const pairs = new Set<string>();
  for (const constraint of mesh.constraints) {
    pairs.add(pairKey(constraint.a, constraint.b));
  }
  connectedPairCache.set(mesh, pairs);
  return pairs;
}

function complianceFor(
  kind: ClothConstraintKind,
  material: ClothMaterial,
  axis: "warp" | "weft" | "bias" | "none" | undefined,
) {
  if (kind === "structural") {
    if (axis === "warp") {
      return material.stretchWarpCompliance ?? material.stretchCompliance;
    }
    if (axis === "weft") {
      return material.stretchWeftCompliance ?? material.stretchCompliance;
    }
    return material.stretchCompliance;
  }
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
  const alpha =
    complianceFor(constraint.kind, material, constraint.axis) / (dt * dt);
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

function hashCell(x: number, y: number, z: number) {
  return `${x},${y},${z}`;
}

export function solveGarmentSelfCollisions(
  mesh: GarmentMesh,
  material: ClothMaterial,
) {
  const minimumDistance = Math.max(0.48, material.thicknessCm * 2.15);
  const cellSize = minimumDistance;
  const buckets = new Map<string, number[]>();
  const particleCount = mesh.inverseMass.length;
  const connected = connectedPairs(mesh);

  for (let particle = 0; particle < particleCount; particle += 1) {
    const offset = particle * 3;
    const cellX = Math.floor(mesh.positions[offset] / cellSize);
    const cellY = Math.floor(mesh.positions[offset + 1] / cellSize);
    const cellZ = Math.floor(mesh.positions[offset + 2] / cellSize);
    const key = hashCell(cellX, cellY, cellZ);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(particle);
    else buckets.set(key, [particle]);
  }

  let collisions = 0;

  for (let a = 0; a < particleCount; a += 1) {
    const ao = a * 3;
    const ax = mesh.positions[ao];
    const ay = mesh.positions[ao + 1];
    const az = mesh.positions[ao + 2];
    const cellX = Math.floor(ax / cellSize);
    const cellY = Math.floor(ay / cellSize);
    const cellZ = Math.floor(az / cellSize);

    for (let dzCell = -1; dzCell <= 1; dzCell += 1) {
      for (let dyCell = -1; dyCell <= 1; dyCell += 1) {
        for (let dxCell = -1; dxCell <= 1; dxCell += 1) {
          const bucket = buckets.get(
            hashCell(cellX + dxCell, cellY + dyCell, cellZ + dzCell),
          );
          if (!bucket) continue;

          for (const b of bucket) {
            if (b <= a || connected.has(pairKey(a, b))) continue;

            const bo = b * 3;
            let dx = mesh.positions[bo] - mesh.positions[ao];
            let dy = mesh.positions[bo + 1] - mesh.positions[ao + 1];
            let dz = mesh.positions[bo + 2] - mesh.positions[ao + 2];
            let distance = Math.hypot(dx, dy, dz);
            if (distance >= minimumDistance) continue;

            if (distance < 1e-7) {
              const axis = (a * 73856093 + b * 19349663) % 3;
              dx = axis === 0 ? 1 : 0;
              dy = axis === 1 ? 1 : 0;
              dz = axis === 2 ? 1 : 0;
              distance = 1;
            }

            const wa = mesh.inverseMass[a];
            const wb = mesh.inverseMass[b];
            const totalWeight = wa + wb;
            if (totalWeight <= 0) continue;

            const penetration = minimumDistance - distance;
            const nx = dx / distance;
            const ny = dy / distance;
            const nz = dz / distance;
            const correction = penetration / totalWeight;

            if (wa > 0) {
              mesh.positions[ao] -= nx * correction * wa;
              mesh.positions[ao + 1] -= ny * correction * wa;
              mesh.positions[ao + 2] -= nz * correction * wa;
            }
            if (wb > 0) {
              mesh.positions[bo] += nx * correction * wb;
              mesh.positions[bo + 1] += ny * correction * wb;
              mesh.positions[bo + 2] += nz * correction * wb;
            }

            collisions += 1;
          }
        }
      }
    }
  }

  return collisions;
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
  let selfCollisions = 0;

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

    if (iteration % 3 === 2 || iteration === iterations - 1) {
      selfCollisions += solveGarmentSelfCollisions(mesh, material);

      // Self-collision is solved after body collision and can push a fold back
      // into an anatomical primitive. Re-project once so each solver iteration
      // finishes satisfying the body non-penetration constraint.
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
  }

  return {
    steps: 1,
    collisions,
    selfCollisions,
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
  let selfCollisions = 0;
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
    selfCollisions += result.selfCollisions;
    maxDisplacementCm = Math.max(maxDisplacementCm, result.maxDisplacementCm);
  }

  return {
    steps: params.steps,
    collisions,
    selfCollisions,
    maxDisplacementCm,
  };
}
