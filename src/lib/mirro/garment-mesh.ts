import { bodyRingY, getBodySectionAtY } from "./body-collision";
import type {
  BodyCollisionPrimitive,
  BodyMesh,
  ClothConstraint,
  ClothConstraintKind,
  ClothConstraintAxis,
  ClothMaterial,
  FabricWeight,
  Garment,
  GarmentCalibration,
  GarmentCategory,
  GarmentMesh,
  GarmentMeshRegion,
  GarmentRegionKind,
  GarmentSilhouette,
  StretchLevel,
} from "./types";

type Vec3 = [number, number, number];
type Vec2 = [number, number];

type MeshContext = {
  positions: number[];
  previousPositions: number[];
  inverseMass: number[];
  uv: number[];
  textureSide: number[];
  regionIds: number[];
  indices: number[];
  constraints: ClothConstraint[];
  regions: GarmentMeshRegion[];
  particleInverseMass: number;
};

type RegionHandle = {
  id: number;
  kind: GarmentRegionKind;
  rows: number;
  cols: number;
  vertex: (row: number, col: number) => number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function sampleProfile(profile: number[], t: number) {
  if (profile.length === 0) return 0;
  const position = clamp(t, 0, 1) * (profile.length - 1);
  const left = Math.floor(position);
  const right = Math.min(profile.length - 1, left + 1);
  const mix = position - left;
  return profile[left] + (profile[right] - profile[left]) * mix;
}

function sampleIntervals(silhouette: GarmentSilhouette, t: number) {
  const profile = silhouette.intervalProfile;
  if (!profile?.length) return [] as Array<[number, number]>;
  const index = clamp(Math.round(t * (profile.length - 1)), 0, profile.length - 1);
  return profile[index] ?? [];
}

function distance(positions: number[], a: number, b: number) {
  const ao = a * 3;
  const bo = b * 3;
  return Math.hypot(
    positions[bo] - positions[ao],
    positions[bo + 1] - positions[ao + 1],
    positions[bo + 2] - positions[ao + 2],
  );
}

function addConstraint(
  constraints: ClothConstraint[],
  positions: number[],
  kind: ClothConstraintKind,
  a: number,
  b: number,
  restScale = 1,
  axis: ClothConstraintAxis = "none",
) {
  constraints.push({
    kind,
    axis,
    a,
    b,
    restLength: distance(positions, a, b) * restScale,
    lambda: 0,
  });
}

function materialCompliance(stretch: StretchLevel) {
  if (stretch === "none") return 0.0000004;
  if (stretch === "low") return 0.000002;
  if (stretch === "medium") return 0.00001;
  return 0.000035;
}

export function defaultFabricPhysicalProfile(
  weight: FabricWeight,
  stretch: StretchLevel,
) {
  const baseStretch =
    stretch === "none" ? 2 : stretch === "low" ? 7 : stretch === "medium" ? 15 : 28;

  return {
    densityGsm: weight === "light" ? 120 : weight === "heavy" ? 320 : 190,
    thicknessMm: weight === "light" ? 0.45 : weight === "heavy" ? 1.5 : 0.85,
    stretchWarpPct: baseStretch,
    stretchWeftPct: Math.min(45, baseStretch * 1.28),
    bendStiffness: weight === "light" ? 28 : weight === "heavy" ? 82 : 55,
    friction: weight === "light" ? 0.12 : weight === "heavy" ? 0.26 : 0.18,
  };
}

function stretchPctToCompliance(percent: number) {
  const normalized = clamp(percent, 0, 45) / 45;
  return 0.00000035 + normalized * normalized * 0.000045;
}

function stiffnessToBendCompliance(stiffness: number) {
  const flexibility = 1 - clamp(stiffness, 0, 100) / 100;
  return 0.000015 + flexibility * flexibility * 0.00042;
}

export function clothMaterialForGarment(garment: Garment): ClothMaterial {
  const fallback = defaultFabricPhysicalProfile(
    garment.fabricWeight,
    garment.stretch,
  );
  const profile = garment.physicalProfile ?? fallback;
  const legacyCompliance = materialCompliance(garment.stretch);
  const warpCompliance = garment.physicalProfile
    ? stretchPctToCompliance(profile.stretchWarpPct)
    : legacyCompliance;
  const weftCompliance = garment.physicalProfile
    ? stretchPctToCompliance(profile.stretchWeftPct)
    : legacyCompliance;

  return {
    stretchCompliance: (warpCompliance + weftCompliance) / 2,
    stretchWarpCompliance: warpCompliance,
    stretchWeftCompliance: weftCompliance,
    shearCompliance: Math.max(warpCompliance, weftCompliance) * 1.35,
    bendCompliance: garment.physicalProfile
      ? stiffnessToBendCompliance(profile.bendStiffness)
      : garment.fabricWeight === "light"
        ? 0.00035
        : garment.fabricWeight === "heavy"
          ? 0.000035
          : 0.00012,
    densityGsm: profile.densityGsm,
    particleInverseMass: clamp(180 / Math.max(60, profile.densityGsm), 0.35, 2.2),
    seamCompliance: 0.00000008,
    damping: clamp(0.996 - profile.densityGsm / 100000, 0.988, 0.995),
    gravityCmPerSec2: 981,
    thicknessCm: clamp(profile.thicknessMm / 10, 0.025, 0.3),
    friction: clamp(profile.friction, 0.02, 0.65),
  };
}

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

function averageAspect(calibration: GarmentCalibration) {
  const front =
    calibration.front.bounds.height / Math.max(1, calibration.front.bounds.width);
  const back =
    calibration.back.bounds.height / Math.max(1, calibration.back.bounds.width);
  return (front + back) / 2;
}

function pushRegion(params: {
  context: MeshContext;
  kind: GarmentRegionKind;
  side: 0 | 1;
  rows: number;
  cols: number;
  position: (v: number, u: number) => Vec3;
  texcoord: (v: number, u: number) => Vec2;
}) {
  const { context, kind, side, rows, cols, position, texcoord } = params;
  const id = context.regions.length;
  const vertexStart = context.positions.length / 3;
  const indexStart = context.indices.length;

  function vertex(row: number, col: number) {
    return vertexStart + row * cols + col;
  }

  for (let row = 0; row < rows; row += 1) {
    const v = row / Math.max(1, rows - 1);
    for (let col = 0; col < cols; col += 1) {
      const u = col / Math.max(1, cols - 1);
      const p = position(v, u);
      const tex = texcoord(v, u);
      context.positions.push(...p);
      context.previousPositions.push(...p);
      context.inverseMass.push(context.particleInverseMass);
      context.uv.push(tex[0], tex[1]);
      context.textureSide.push(side);
      context.regionIds.push(id);
    }
  }

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const here = vertex(row, col);

      if (col + 1 < cols) {
        addConstraint(
          context.constraints,
          context.positions,
          "structural",
          here,
          vertex(row, col + 1),
          1,
          "weft",
        );
      }
      if (row + 1 < rows) {
        addConstraint(
          context.constraints,
          context.positions,
          "structural",
          here,
          vertex(row + 1, col),
          1,
          "warp",
        );
      }
      if (row + 1 < rows && col + 1 < cols) {
        addConstraint(
          context.constraints,
          context.positions,
          "shear",
          here,
          vertex(row + 1, col + 1),
          1,
          "bias",
        );
      }
      if (row + 1 < rows && col > 0) {
        addConstraint(
          context.constraints,
          context.positions,
          "shear",
          here,
          vertex(row + 1, col - 1),
          1,
          "bias",
        );
      }
      if (col + 2 < cols) {
        addConstraint(
          context.constraints,
          context.positions,
          "bend",
          here,
          vertex(row, col + 2),
          1,
          "weft",
        );
      }
      if (row + 2 < rows) {
        addConstraint(
          context.constraints,
          context.positions,
          "bend",
          here,
          vertex(row + 2, col),
          1,
          "warp",
        );
      }

      if (row + 1 < rows && col + 1 < cols) {
        const a = vertex(row, col);
        const b = vertex(row, col + 1);
        const cc = vertex(row + 1, col);
        const d = vertex(row + 1, col + 1);
        if (side === 0) {
          context.indices.push(a, cc, b, b, cc, d);
        } else {
          context.indices.push(a, b, cc, b, d, cc);
        }
      }
    }
  }

  context.regions.push({
    id,
    kind,
    vertexStart,
    vertexCount: rows * cols,
    indexStart,
    indexCount: context.indices.length - indexStart,
  });

  return { id, kind, rows, cols, vertex } satisfies RegionHandle;
}

function seamRows(
  context: MeshContext,
  a: RegionHandle,
  aRow: number,
  b: RegionHandle,
  bRow: number,
  restScale = 0.08,
) {
  const count = Math.min(a.cols, b.cols);
  for (let i = 0; i < count; i += 1) {
    const aCol = Math.round((i / Math.max(1, count - 1)) * (a.cols - 1));
    const bCol = Math.round((i / Math.max(1, count - 1)) * (b.cols - 1));
    addConstraint(
      context.constraints,
      context.positions,
      "seam",
      a.vertex(aRow, aCol),
      b.vertex(bRow, bCol),
      restScale,
    );
  }
}

function seamColumns(
  context: MeshContext,
  a: RegionHandle,
  aCol: number,
  b: RegionHandle,
  bCol: number,
  restScale = 0.06,
) {
  const count = Math.min(a.rows, b.rows);
  for (let i = 0; i < count; i += 1) {
    const aRow = Math.round((i / Math.max(1, count - 1)) * (a.rows - 1));
    const bRow = Math.round((i / Math.max(1, count - 1)) * (b.rows - 1));
    addConstraint(
      context.constraints,
      context.positions,
      "seam",
      a.vertex(aRow, aCol),
      b.vertex(bRow, bCol),
      restScale,
    );
  }
}

function uvForBounds(
  silhouette: GarmentSilhouette,
  normalizedX: number,
  normalizedY: number,
): Vec2 {
  return [
    (silhouette.bounds.x +
      clamp(normalizedX, 0, 1) * Math.max(1, silhouette.bounds.width - 1)) /
      silhouette.sourceWidth,
    (silhouette.bounds.y +
      clamp(normalizedY, 0, 1) * Math.max(1, silhouette.bounds.height - 1)) /
      silhouette.sourceHeight,
  ];
}

function findLimb(
  bodyMesh: BodyMesh,
  part: "left-arm" | "right-arm" | "left-leg" | "right-leg",
) {
  return bodyMesh.collisionPrimitives?.find(
    (primitive): primitive is Extract<
      BodyCollisionPrimitive,
      { type: "tapered-capsule" }
    > => primitive.type === "tapered-capsule" && primitive.part === part,
  );
}

function limbBasis(primitive: Extract<BodyCollisionPrimitive, { type: "tapered-capsule" }>) {
  const axis = vecNormalize(vecSub(primitive.end, primitive.start));
  const reference: Vec3 = [0, 0, 1];
  let basisX = vecNormalize(vecCross(reference, axis));
  if (vecLength(basisX) < 0.25) basisX = [1, 0, 0];
  let basisZ = vecNormalize(vecCross(axis, basisX));
  if (basisZ[2] < 0) basisZ = [-basisZ[0], -basisZ[1], -basisZ[2]];
  return { axis, basisX, basisZ };
}

function limbSurfacePosition(params: {
  primitive: Extract<BodyCollisionPrimitive, { type: "tapered-capsule" }>;
  v: number;
  u: number;
  front: boolean;
  lengthFraction: number;
  ease: number;
  thickness: number;
}) {
  const { primitive, v, u, front, lengthFraction, ease, thickness } = params;
  const t = clamp(v * lengthFraction, 0, 1);
  const center: Vec3 = [
    primitive.start[0] + (primitive.end[0] - primitive.start[0]) * t,
    primitive.start[1] + (primitive.end[1] - primitive.start[1]) * t,
    primitive.start[2] + (primitive.end[2] - primitive.start[2]) * t,
  ];
  const bodyRadius =
    primitive.startRadius +
    (primitive.endRadius - primitive.startRadius) * t;
  const radius = bodyRadius * ease + thickness * 2.3;
  const { basisX, basisZ } = limbBasis(primitive);
  const angle = front ? u * Math.PI : -u * Math.PI;
  const cx = Math.cos(angle) * radius;
  const sz = Math.sin(angle) * radius;

  return [
    center[0] + basisX[0] * cx + basisZ[0] * sz,
    center[1] + basisX[1] * cx + basisZ[1] * sz,
    center[2] + basisX[2] * cx + basisZ[2] * sz,
  ] as Vec3;
}

function torsoTextureRange(silhouette: GarmentSilhouette) {
  const width = clamp(sampleProfile(silhouette.widthProfile, 0.58), 0.38, 0.95);
  const center = clamp(0.5 + sampleProfile(silhouette.centerProfile, 0.58), 0.3, 0.7);
  return {
    min: clamp(center - width / 2, 0, 1),
    max: clamp(center + width / 2, 0, 1),
  };
}

function buildTopMesh(
  context: MeshContext,
  garment: Garment,
  calibration: GarmentCalibration,
  bodyMesh: BodyMesh,
  material: ClothMaterial,
) {
  const category = garment.category;
  const rows = category === "hoodie" ? 30 : 28;
  const cols = 16;
  const ease = category === "hoodie" ? 1.18 : category === "shirt" ? 1.11 : 1.08;
  const shoulderRing =
    bodyMesh.landmarks.shoulderRing ?? Math.round(bodyMesh.ringCount * 0.18);
  const startY = bodyRingY(bodyMesh, shoulderRing) + bodyMesh.boundsCm.height * 0.018;
  const expectedHeight =
    bodyMesh.boundsCm.height *
    (category === "hoodie" ? 0.42 : category === "shirt" ? 0.38 : 0.35);
  const chestSection = getBodySectionAtY(
    bodyMesh,
    bodyRingY(bodyMesh, bodyMesh.landmarks.chestRing),
  );
  const targetWidth = chestSection.radiusX * 2 * ease;
  const reference =
    (sampleProfile(calibration.front.widthProfile, 0.58) +
      sampleProfile(calibration.back.widthProfile, 0.58)) /
    2;
  const scale = targetWidth / Math.max(0.22, reference);
  const imageHeight = scale * averageAspect(calibration);
  const garmentHeight = clamp(
    imageHeight,
    expectedHeight * 0.78,
    expectedHeight * 1.24,
  );

  const handles: Record<string, RegionHandle> = {};

  for (const side of [0, 1] as const) {
    const silhouette = side === 0 ? calibration.front : calibration.back;
    const sign = side === 0 ? 1 : -1;
    const textureRange = torsoTextureRange(silhouette);
    const kind: GarmentRegionKind =
      side === 0 ? "torso-front" : "torso-back";

    handles[kind] = pushRegion({
      context,
      kind,
      side,
      rows,
      cols,
      position(v, u) {
        const y = startY - v * garmentHeight;
        const section = getBodySectionAtY(bodyMesh, y);
        const shapeReference = Math.max(
          0.2,
          sampleProfile(silhouette.widthProfile, 0.58),
        );
        const shape =
          clamp(
            sampleProfile(silhouette.widthProfile, 0.2 + v * 0.8) /
              shapeReference,
            0.76,
            1.22,
          );
        const halfWidth = section.radiusX * ease * shape;
        const x = (u - 0.5) * halfWidth * 2;
        const normalizedX = x / Math.max(section.radiusX, 0.65);
        const surface =
          Math.abs(normalizedX) < 1
            ? section.radiusZ *
              Math.sqrt(Math.max(0, 1 - normalizedX * normalizedX))
            : section.radiusZ * 0.22;
        return [x, y, sign * (surface + material.thicknessCm * 2.3)];
      },
      texcoord(v, u) {
        return uvForBounds(
          silhouette,
          textureRange.min + (textureRange.max - textureRange.min) * u,
          0.04 + v * 0.94,
        );
      },
    });
  }

  seamColumns(
    context,
    handles["torso-front"],
    0,
    handles["torso-back"],
    0,
  );
  seamColumns(
    context,
    handles["torso-front"],
    cols - 1,
    handles["torso-back"],
    cols - 1,
  );

  const shoulderSpan = Math.floor(cols * 0.28);
  for (let col = 0; col < shoulderSpan; col += 1) {
    addConstraint(
      context.constraints,
      context.positions,
      "seam",
      handles["torso-front"].vertex(0, col),
      handles["torso-back"].vertex(0, col),
      0.06,
    );
    const mirrored = cols - 1 - col;
    addConstraint(
      context.constraints,
      context.positions,
      "seam",
      handles["torso-front"].vertex(0, mirrored),
      handles["torso-back"].vertex(0, mirrored),
      0.06,
    );
  }

  const sleeveLengthFraction =
    category === "hoodie" ? 0.94 : category === "shirt" ? 0.7 : 0.42;
  const sleeveRows = category === "hoodie" ? 20 : 14;
  const sleeveCols = 7;

  for (const arm of ["left-arm", "right-arm"] as const) {
    const primitive = findLimb(bodyMesh, arm);
    if (!primitive) continue;
    const left = arm === "left-arm";

    for (const side of [0, 1] as const) {
      const silhouette = side === 0 ? calibration.front : calibration.back;
      const kind = (
        left
          ? side === 0
            ? "left-sleeve-front"
            : "left-sleeve-back"
          : side === 0
            ? "right-sleeve-front"
            : "right-sleeve-back"
      ) satisfies GarmentRegionKind;
      const outerMin = left ? 0 : 0.72;
      const outerMax = left ? 0.28 : 1;

      handles[kind] = pushRegion({
        context,
        kind,
        side,
        rows: sleeveRows,
        cols: sleeveCols,
        position(v, u) {
          return limbSurfacePosition({
            primitive,
            v,
            u,
            front: side === 0,
            lengthFraction: sleeveLengthFraction,
            ease: ease + (category === "hoodie" ? 0.08 : 0.03),
            thickness: material.thicknessCm,
          });
        },
        texcoord(v, u) {
          return uvForBounds(
            silhouette,
            outerMin + (outerMax - outerMin) * u,
            0.02 + v * (category === "hoodie" ? 0.62 : 0.42),
          );
        },
      });
    }

    const frontKind =
      left ? "left-sleeve-front" : "right-sleeve-front";
    const backKind =
      left ? "left-sleeve-back" : "right-sleeve-back";
    seamColumns(
      context,
      handles[frontKind],
      0,
      handles[backKind],
      0,
      0.05,
    );
    seamColumns(
      context,
      handles[frontKind],
      sleeveCols - 1,
      handles[backKind],
      sleeveCols - 1,
      0.05,
    );

    const torsoCols = handles["torso-front"].cols;
    const frontTorso = handles["torso-front"];
    const backTorso = handles["torso-back"];
    const rootFront = handles[frontKind];
    const rootBack = handles[backKind];
    const attachColumns = Math.min(sleeveCols, shoulderSpan + 1);

    for (let i = 0; i < attachColumns; i += 1) {
      const torsoCol = left
        ? i
        : torsoCols - 1 - i;
      const sleeveCol = left ? i : sleeveCols - 1 - i;
      addConstraint(
        context.constraints,
        context.positions,
        "seam",
        rootFront.vertex(0, sleeveCol),
        frontTorso.vertex(0, clamp(torsoCol, 0, torsoCols - 1)),
        0.08,
      );
      addConstraint(
        context.constraints,
        context.positions,
        "seam",
        rootBack.vertex(0, sleeveCol),
        backTorso.vertex(0, clamp(torsoCol, 0, torsoCols - 1)),
        0.08,
      );
    }
  }

  return { rows, cols };
}

function persistentSplitRatio(silhouette: GarmentSilhouette) {
  const profile = silhouette.intervalProfile;
  if (!profile?.length) return 0.42;

  const start = Math.floor(profile.length * 0.2);
  for (let i = start; i < profile.length - 2; i += 1) {
    if (
      (profile[i]?.length ?? 0) >= 2 &&
      (profile[i + 1]?.length ?? 0) >= 2 &&
      (profile[i + 2]?.length ?? 0) >= 2
    ) {
      return clamp(i / Math.max(1, profile.length - 1), 0.28, 0.62);
    }
  }
  return 0.42;
}

function legUvInterval(
  silhouette: GarmentSilhouette,
  v: number,
  right: boolean,
) {
  const intervals = sampleIntervals(silhouette, v);
  if (intervals.length >= 2) {
    return right ? intervals[intervals.length - 1] : intervals[0];
  }
  return right ? ([0.52, 1] as const) : ([0, 0.48] as const);
}

function buildBottomMesh(
  context: MeshContext,
  garment: Garment,
  calibration: GarmentCalibration,
  bodyMesh: BodyMesh,
  material: ClothMaterial,
) {
  const isShorts = garment.category === "shorts";
  const waistRows = 8;
  const waistCols = 16;
  const legRows = isShorts ? 12 : 30;
  const legCols = 8;
  const ease = isShorts ? 1.09 : 1.06;
  const waistY =
    bodyRingY(bodyMesh, bodyMesh.landmarks.waistRing) +
    bodyMesh.boundsCm.height * 0.018;
  const crotchRing =
    bodyMesh.landmarks.crotchRing ?? Math.round(bodyMesh.ringCount * 0.63);
  const crotchY = bodyRingY(bodyMesh, crotchRing);
  const frontSplit = persistentSplitRatio(calibration.front);
  const backSplit = persistentSplitRatio(calibration.back);
  const splitRatio = (frontSplit + backSplit) / 2;
  const handles: Record<string, RegionHandle> = {};

  for (const side of [0, 1] as const) {
    const silhouette = side === 0 ? calibration.front : calibration.back;
    const sign = side === 0 ? 1 : -1;
    const kind: GarmentRegionKind =
      side === 0 ? "waist-front" : "waist-back";

    handles[kind] = pushRegion({
      context,
      kind,
      side,
      rows: waistRows,
      cols: waistCols,
      position(v, u) {
        const y = waistY + (crotchY - waistY) * v;
        const section = getBodySectionAtY(bodyMesh, y);
        const x = (u - 0.5) * section.radiusX * 2 * ease;
        const normalizedX = x / Math.max(section.radiusX, 0.65);
        const surface =
          Math.abs(normalizedX) < 1
            ? section.radiusZ *
              Math.sqrt(Math.max(0, 1 - normalizedX * normalizedX))
            : section.radiusZ * 0.2;
        return [x, y, sign * (surface + material.thicknessCm * 2.4)];
      },
      texcoord(v, u) {
        return uvForBounds(
          silhouette,
          u,
          v * splitRatio,
        );
      },
    });
  }

  seamColumns(
    context,
    handles["waist-front"],
    0,
    handles["waist-back"],
    0,
  );
  seamColumns(
    context,
    handles["waist-front"],
    waistCols - 1,
    handles["waist-back"],
    waistCols - 1,
  );

  for (const leg of ["left-leg", "right-leg"] as const) {
    const primitive = findLimb(bodyMesh, leg);
    if (!primitive) continue;
    const right = leg === "right-leg";
    const lengthFraction = isShorts ? 0.38 : 0.97;

    for (const side of [0, 1] as const) {
      const silhouette = side === 0 ? calibration.front : calibration.back;
      const kind = (
        right
          ? side === 0
            ? "right-leg-front"
            : "right-leg-back"
          : side === 0
            ? "left-leg-front"
            : "left-leg-back"
      ) satisfies GarmentRegionKind;

      handles[kind] = pushRegion({
        context,
        kind,
        side,
        rows: legRows,
        cols: legCols,
        position(v, u) {
          return limbSurfacePosition({
            primitive,
            v,
            u,
            front: side === 0,
            lengthFraction,
            ease,
            thickness: material.thicknessCm,
          });
        },
        texcoord(v, u) {
          const imageV = splitRatio + v * (1 - splitRatio);
          const interval = legUvInterval(silhouette, imageV, right);
          return uvForBounds(
            silhouette,
            interval[0] + (interval[1] - interval[0]) * u,
            imageV,
          );
        },
      });
    }

    const frontKind =
      right ? "right-leg-front" : "left-leg-front";
    const backKind =
      right ? "right-leg-back" : "left-leg-back";
    seamColumns(
      context,
      handles[frontKind],
      0,
      handles[backKind],
      0,
      0.05,
    );
    seamColumns(
      context,
      handles[frontKind],
      legCols - 1,
      handles[backKind],
      legCols - 1,
      0.05,
    );

    const waistFront = handles["waist-front"];
    const waistBack = handles["waist-back"];
    const half = Math.floor(waistCols / 2);
    for (let i = 0; i < legCols; i += 1) {
      const ratio = i / Math.max(1, legCols - 1);
      const waistCol = right
        ? half + Math.round(ratio * (waistCols - 1 - half))
        : Math.round(ratio * Math.max(0, half - 1));
      addConstraint(
        context.constraints,
        context.positions,
        "seam",
        handles[frontKind].vertex(0, i),
        waistFront.vertex(waistRows - 1, waistCol),
        0.08,
      );
      addConstraint(
        context.constraints,
        context.positions,
        "seam",
        handles[backKind].vertex(0, i),
        waistBack.vertex(waistRows - 1, waistCol),
        0.08,
      );
    }
  }

  const leftFront = handles["left-leg-front"];
  const rightFront = handles["right-leg-front"];
  const leftBack = handles["left-leg-back"];
  const rightBack = handles["right-leg-back"];
  if (leftFront && rightFront && leftBack && rightBack) {
    const crotchRows = Math.min(5, legRows);
    for (let row = 0; row < crotchRows; row += 1) {
      addConstraint(
        context.constraints,
        context.positions,
        "seam",
        leftFront.vertex(row, legCols - 1),
        rightFront.vertex(row, 0),
        0.1,
      );
      addConstraint(
        context.constraints,
        context.positions,
        "seam",
        leftBack.vertex(row, legCols - 1),
        rightBack.vertex(row, 0),
        0.1,
      );
    }
  }

  return { rows: waistRows + legRows, cols: waistCols };
}

function meshBounds(positions: number[]) {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (let index = 0; index < positions.length; index += 3) {
    minX = Math.min(minX, positions[index]);
    minY = Math.min(minY, positions[index + 1]);
    minZ = Math.min(minZ, positions[index + 2]);
    maxX = Math.max(maxX, positions[index]);
    maxY = Math.max(maxY, positions[index + 1]);
    maxZ = Math.max(maxZ, positions[index + 2]);
  }

  return {
    width: maxX - minX,
    height: maxY - minY,
    depth: maxZ - minZ,
  };
}

export function buildGarmentMesh(params: {
  garment: Garment;
  calibration: GarmentCalibration;
  bodyMesh: BodyMesh;
}): GarmentMesh {
  const { garment, calibration, bodyMesh } = params;
  const material = clothMaterialForGarment(garment);
  const context: MeshContext = {
    positions: [],
    previousPositions: [],
    inverseMass: [],
    uv: [],
    textureSide: [],
    regionIds: [],
    indices: [],
    constraints: [],
    regions: [],
    particleInverseMass: material.particleInverseMass ?? 1,
  };

  const grid =
    garment.category === "pants" || garment.category === "shorts"
      ? buildBottomMesh(context, garment, calibration, bodyMesh, material)
      : buildTopMesh(context, garment, calibration, bodyMesh, material);

  const frontVertexCount = context.textureSide.filter((side) => side === 0).length;

  return {
    version: 2,
    coordinateSystem: "x-right-y-up-z-front-centimeters",
    category: garment.category,
    rows: grid.rows,
    cols: grid.cols,
    panelVertexCount: frontVertexCount,
    positions: context.positions,
    previousPositions: context.previousPositions,
    inverseMass: context.inverseMass,
    uv: context.uv,
    indices: context.indices,
    constraints: context.constraints,
    textureSide: context.textureSide,
    regionIds: context.regionIds,
    regions: context.regions,
    boundsCm: meshBounds(context.positions),
  };
}

export function cloneGarmentMesh(mesh: GarmentMesh): GarmentMesh {
  return {
    ...mesh,
    positions: [...mesh.positions],
    previousPositions: [...mesh.previousPositions],
    inverseMass: [...mesh.inverseMass],
    uv: [...mesh.uv],
    indices: [...mesh.indices],
    constraints: mesh.constraints.map((constraint) => ({
      ...constraint,
      lambda: 0,
    })),
    textureSide: mesh.textureSide ? [...mesh.textureSide] : undefined,
    regionIds: mesh.regionIds ? [...mesh.regionIds] : undefined,
    regions: mesh.regions?.map((region) => ({ ...region })),
    boundsCm: { ...mesh.boundsCm },
  };
}
