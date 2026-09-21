import { bodyRingY, getBodySectionAtY } from "./body-collision";
import type {
  BodyMesh,
  ClothConstraint,
  ClothConstraintKind,
  ClothMaterial,
  FabricWeight,
  Garment,
  GarmentCalibration,
  GarmentCategory,
  GarmentMesh,
  StretchLevel,
} from "./types";

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
) {
  constraints.push({
    kind,
    a,
    b,
    restLength: distance(positions, a, b) * restScale,
    lambda: 0,
  });
}

function gridForCategory(category: GarmentCategory) {
  if (category === "pants") return { rows: 38, cols: 20, expectedHeightRatio: 0.5 };
  if (category === "shorts") return { rows: 26, cols: 20, expectedHeightRatio: 0.26 };
  if (category === "hoodie") return { rows: 34, cols: 22, expectedHeightRatio: 0.42 };
  if (category === "shirt") return { rows: 32, cols: 22, expectedHeightRatio: 0.38 };
  return { rows: 30, cols: 22, expectedHeightRatio: 0.35 };
}

function materialCompliance(stretch: StretchLevel) {
  if (stretch === "none") return 0.0000004;
  if (stretch === "low") return 0.000002;
  if (stretch === "medium") return 0.00001;
  return 0.000035;
}

function bendingCompliance(weight: FabricWeight) {
  if (weight === "light") return 0.00035;
  if (weight === "heavy") return 0.000035;
  return 0.00012;
}

export function clothMaterialForGarment(garment: Garment): ClothMaterial {
  const thickness =
    garment.fabricWeight === "light" ? 0.28 : garment.fabricWeight === "heavy" ? 0.72 : 0.46;

  return {
    stretchCompliance: materialCompliance(garment.stretch),
    shearCompliance: materialCompliance(garment.stretch) * 1.4,
    bendCompliance: bendingCompliance(garment.fabricWeight),
    seamCompliance: 0.00000008,
    damping: garment.fabricWeight === "heavy" ? 0.988 : garment.fabricWeight === "light" ? 0.994 : 0.991,
    gravityCmPerSec2: 981,
    thicknessCm: thickness,
    friction: garment.fabricWeight === "heavy" ? 0.16 : 0.1,
  };
}

function bodyAnchor(mesh: BodyMesh, category: GarmentCategory) {
  if (category === "pants" || category === "shorts") {
    return {
      referenceRing: mesh.landmarks.hipsRing,
      startY: bodyRingY(mesh, mesh.landmarks.waistRing) + mesh.boundsCm.height * 0.018,
      referenceRowRatio: 0.18,
      ease: category === "pants" ? 1.055 : 1.075,
    };
  }

  return {
    referenceRing: mesh.landmarks.chestRing,
    startY: bodyRingY(mesh, mesh.landmarks.chestRing) + mesh.boundsCm.height * 0.105,
    referenceRowRatio: 0.3,
    ease: category === "hoodie" ? 1.18 : category === "shirt" ? 1.1 : 1.08,
  };
}

function averageAspect(calibration: GarmentCalibration) {
  const front = calibration.front.bounds.height / Math.max(1, calibration.front.bounds.width);
  const back = calibration.back.bounds.height / Math.max(1, calibration.back.bounds.width);
  return (front + back) / 2;
}

export function buildGarmentMesh(params: {
  garment: Garment;
  calibration: GarmentCalibration;
  bodyMesh: BodyMesh;
}): GarmentMesh {
  const { garment, calibration, bodyMesh } = params;
  const grid = gridForCategory(garment.category);
  const anchor = bodyAnchor(bodyMesh, garment.category);
  const material = clothMaterialForGarment(garment);
  const referenceY = bodyRingY(bodyMesh, anchor.referenceRing);
  const bodySection = getBodySectionAtY(bodyMesh, referenceY);
  const targetPanelWidth = bodySection.radiusX * 2 * anchor.ease;

  const frontReference = Math.max(
    0.15,
    sampleProfile(calibration.front.widthProfile, anchor.referenceRowRatio),
  );
  const backReference = Math.max(
    0.15,
    sampleProfile(calibration.back.widthProfile, anchor.referenceRowRatio),
  );
  const referenceProfile = (frontReference + backReference) / 2;
  const widthScaleCm = targetPanelWidth / referenceProfile;
  const expectedHeight = bodyMesh.boundsCm.height * grid.expectedHeightRatio;
  const imageHeight = widthScaleCm * averageAspect(calibration);
  const garmentHeight = clamp(imageHeight, expectedHeight * 0.72, expectedHeight * 1.28);

  const panelVertexCount = grid.rows * grid.cols;
  const totalVertices = panelVertexCount * 2;
  const positions = new Array<number>(totalVertices * 3).fill(0);
  const previousPositions = new Array<number>(totalVertices * 3).fill(0);
  const inverseMass = new Array<number>(totalVertices).fill(1);
  const uv = new Array<number>(totalVertices * 2).fill(0);
  const indices: number[] = [];
  const constraints: ClothConstraint[] = [];

  function vertex(panel: 0 | 1, row: number, col: number) {
    return panel * panelVertexCount + row * grid.cols + col;
  }

  function writePanel(panel: 0 | 1) {
    const silhouette = panel === 0 ? calibration.front : calibration.back;
    const sign = panel === 0 ? 1 : -1;

    for (let row = 0; row < grid.rows; row += 1) {
      const v = row / Math.max(1, grid.rows - 1);
      const rowWidth = Math.max(0.08, sampleProfile(silhouette.widthProfile, v)) * widthScaleCm;
      const centerOffset = sampleProfile(silhouette.centerProfile, v) * widthScaleCm;
      const y = anchor.startY - v * garmentHeight;
      const section = getBodySectionAtY(bodyMesh, y);

      for (let col = 0; col < grid.cols; col += 1) {
        const u = col / Math.max(1, grid.cols - 1);
        const x = centerOffset + (u - 0.5) * rowWidth;
        const normalizedX = x / Math.max(section.radiusX, 0.65);
        const surface =
          Math.abs(normalizedX) < 1
            ? section.radiusZ * Math.sqrt(Math.max(0, 1 - normalizedX * normalizedX))
            : section.radiusZ * 0.18;
        const z = sign * (surface + material.thicknessCm * 2.25);
        const index = vertex(panel, row, col);
        const offset = index * 3;
        positions[offset] = x;
        positions[offset + 1] = y;
        positions[offset + 2] = z;
        previousPositions[offset] = x;
        previousPositions[offset + 1] = y;
        previousPositions[offset + 2] = z;
        uv[index * 2] = u;
        uv[index * 2 + 1] = v;
      }
    }
  }

  writePanel(0);
  writePanel(1);

  for (const panel of [0, 1] as const) {
    for (let row = 0; row < grid.rows; row += 1) {
      for (let col = 0; col < grid.cols; col += 1) {
        const here = vertex(panel, row, col);

        if (col + 1 < grid.cols) {
          addConstraint(constraints, positions, "structural", here, vertex(panel, row, col + 1));
        }
        if (row + 1 < grid.rows) {
          addConstraint(constraints, positions, "structural", here, vertex(panel, row + 1, col));
        }
        if (row + 1 < grid.rows && col + 1 < grid.cols) {
          addConstraint(constraints, positions, "shear", here, vertex(panel, row + 1, col + 1));
        }
        if (row + 1 < grid.rows && col > 0) {
          addConstraint(constraints, positions, "shear", here, vertex(panel, row + 1, col - 1));
        }
        if (col + 2 < grid.cols) {
          addConstraint(constraints, positions, "bend", here, vertex(panel, row, col + 2));
        }
        if (row + 2 < grid.rows) {
          addConstraint(constraints, positions, "bend", here, vertex(panel, row + 2, col));
        }

        if (row + 1 < grid.rows && col + 1 < grid.cols) {
          const a = vertex(panel, row, col);
          const b = vertex(panel, row, col + 1);
          const c = vertex(panel, row + 1, col);
          const d = vertex(panel, row + 1, col + 1);

          if (panel === 0) {
            indices.push(a, c, b, b, c, d);
          } else {
            indices.push(a, b, c, b, d, c);
          }
        }
      }
    }
  }

  for (let row = 0; row < grid.rows; row += 1) {
    addConstraint(constraints, positions, "seam", vertex(0, row, 0), vertex(1, row, 0), 0.04);
    addConstraint(
      constraints,
      positions,
      "seam",
      vertex(0, row, grid.cols - 1),
      vertex(1, row, grid.cols - 1),
      0.04,
    );
  }

  if (garment.category === "top" || garment.category === "shirt" || garment.category === "hoodie") {
    const shoulderSpan = Math.floor(grid.cols * 0.28);
    for (let col = 0; col < shoulderSpan; col += 1) {
      addConstraint(constraints, positions, "seam", vertex(0, 0, col), vertex(1, 0, col), 0.04);
      const mirrored = grid.cols - 1 - col;
      addConstraint(
        constraints,
        positions,
        "seam",
        vertex(0, 0, mirrored),
        vertex(1, 0, mirrored),
        0.04,
      );
    }
  }

  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  for (let index = 0; index < totalVertices; index += 1) {
    xs.push(positions[index * 3]);
    ys.push(positions[index * 3 + 1]);
    zs.push(positions[index * 3 + 2]);
  }

  return {
    version: 1,
    coordinateSystem: "x-right-y-up-z-front-centimeters",
    category: garment.category,
    rows: grid.rows,
    cols: grid.cols,
    panelVertexCount,
    positions,
    previousPositions,
    inverseMass,
    uv,
    indices,
    constraints,
    boundsCm: {
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
      depth: Math.max(...zs) - Math.min(...zs),
    },
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
    constraints: mesh.constraints.map((constraint) => ({ ...constraint, lambda: 0 })),
    boundsCm: { ...mesh.boundsCm },
  };
}
