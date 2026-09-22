import { describe, expect, it } from "vitest";
import { pointInsideExpandedBody } from "../src/lib/mirro/body-collision";
import { buildBodyCalibration } from "../src/lib/mirro/body-calibration";
import {
  analyzeAlphaSilhouette,
  buildGarmentCalibration,
  type AlphaImage,
} from "../src/lib/mirro/garment-calibration";
import {
  buildGarmentMesh,
  clothMaterialForGarment,
  defaultFabricPhysicalProfile,
} from "../src/lib/mirro/garment-mesh";
import { simulateCloth, solveGarmentSelfCollisions } from "../src/lib/mirro/xpbd";
import type {
  BodySilhouette,
  Garment,
  GarmentMesh,
} from "../src/lib/mirro/types";

function alphaGarment(width = 140, height = 180, back = false): AlphaImage {
  const alpha = new Uint8Array(width * height);
  const center = width / 2 + (back ? 1 : 0);

  for (let y = 12; y < height - 10; y += 1) {
    const t = (y - 12) / (height - 22);
    let halfWidth = 34;
    if (t < 0.12) halfWidth = 55;
    else if (t < 0.3) halfWidth = 45;
    else if (t > 0.78) halfWidth = 36;

    for (
      let x = Math.max(0, Math.floor(center - halfWidth));
      x <= Math.min(width - 1, Math.ceil(center + halfWidth));
      x += 1
    ) {
      alpha[y * width + x] = 255;
    }
  }

  return { width, height, alpha };
}

function alphaPants(width = 150, height = 220): AlphaImage {
  const alpha = new Uint8Array(width * height);
  const center = width / 2;

  for (let y = 10; y < height - 8; y += 1) {
    const t = (y - 10) / (height - 18);

    if (t < 0.42) {
      const halfWidth = 48 - t * 16;
      for (
        let x = Math.max(0, Math.floor(center - halfWidth));
        x <= Math.min(width - 1, Math.ceil(center + halfWidth));
        x += 1
      ) {
        alpha[y * width + x] = 255;
      }
      continue;
    }

    const legWidth = Math.max(18, 28 - t * 7);
    const gap = 12 + t * 8;
    const leftCenter = center - gap / 2 - legWidth / 2;
    const rightCenter = center + gap / 2 + legWidth / 2;

    for (const legCenter of [leftCenter, rightCenter]) {
      for (
        let x = Math.max(0, Math.floor(legCenter - legWidth / 2));
        x <= Math.min(width - 1, Math.ceil(legCenter + legWidth / 2));
        x += 1
      ) {
        alpha[y * width + x] = 255;
      }
    }
  }

  return { width, height, alpha };
}

function fakeBodySilhouette(
  profile: number[],
  confidence = 0.94,
): BodySilhouette {
  return {
    sourceWidth: 400,
    sourceHeight: 800,
    bounds: { x: 100, y: 40, width: 200, height: 720 },
    widthProfile: profile,
    foregroundRatio: 0.29,
    backgroundThreshold: 40,
    confidence,
  };
}

function bodyProfile(samples = 64, side = false) {
  return Array.from({ length: samples }, (_, index) => {
    const t = index / (samples - 1);
    if (t < 0.12) return side ? 0.11 : 0.1;
    if (t < 0.24) return side ? 0.14 : 0.25;
    if (t < 0.39) return side ? 0.15 : 0.235;
    if (t < 0.5) return side ? 0.13 : 0.19;
    if (t < 0.62) return side ? 0.16 : 0.235;
    if (t < 0.78) return side ? 0.13 : 0.19;
    return side ? 0.105 : 0.145;
  });
}

function makeBodyMesh() {
  const front = bodyProfile(64, false);
  const side = bodyProfile(64, true);
  return buildBodyCalibration(
    {
      front: fakeBodySilhouette(front),
      back: fakeBodySilhouette(front.map((value) => value * 0.99), 0.92),
      left: fakeBodySilhouette(side, 0.91),
      right: fakeBodySilhouette(side.map((value) => value * 1.01), 0.93),
    },
    {
      heightCm: 178,
      chestCm: 98,
      waistCm: 82,
      hipsCm: 99,
    },
  ).mesh;
}

function calibrationFromProfiles(): ReturnType<typeof buildGarmentCalibration> {
  const front = analyzeAlphaSilhouette(alphaGarment());
  const back = analyzeAlphaSilhouette(alphaGarment(140, 180, true));
  return buildGarmentCalibration(front, back);
}

function makeGarment(
  calibration: ReturnType<typeof buildGarmentCalibration>,
): Garment {
  return {
    id: "shirt-1",
    name: "Camiseta teste",
    category: "top",
    size: "M",
    fabricWeight: "medium",
    stretch: "low",
    images: {
      front: { key: "front", name: "front.png", type: "image/png", size: 1 },
      back: { key: "back", name: "back.png", type: "image/png", size: 1 },
    },
    calibration,
    createdAt: new Date(0).toISOString(),
  };
}

describe("garment alpha calibration", () => {
  it("extracts a stable silhouette from transparent processed garment images", () => {
    const silhouette = analyzeAlphaSilhouette(alphaGarment());

    expect(silhouette.widthProfile).toHaveLength(48);
    expect(silhouette.centerProfile).toHaveLength(48);
    expect(silhouette.occupancyRatio).toBeGreaterThan(0.5);
    expect(silhouette.widthProfile[3]).toBeGreaterThan(silhouette.widthProfile[30]);
    expect(silhouette.intervalProfile).toHaveLength(48);
  });

  it("detects two independent leg runs from pants alpha", () => {
    const silhouette = analyzeAlphaSilhouette(alphaPants());
    expect(
      silhouette.intervalProfile?.some((intervals) => intervals.length === 2),
    ).toBe(true);
  });

  it("compares front and back without inventing garment geometry", () => {
    const calibration = calibrationFromProfiles();

    expect(calibration.method).toBe("alpha-profile-v1");
    expect(calibration.quality.score).toBeGreaterThan(0.9);
    expect(calibration.quality.frontBackDifference).toBeLessThan(0.03);
  });
});

describe("GarmentMesh + XPBD", () => {
  it("builds semantic torso and sleeve regions with real texture sides", () => {
    const bodyMesh = makeBodyMesh();
    const calibration = calibrationFromProfiles();
    const garment = makeGarment(calibration);
    const mesh = buildGarmentMesh({ garment, calibration, bodyMesh });

    expect(mesh.version).toBe(2);
    expect(mesh.uv).toHaveLength((mesh.positions.length / 3) * 2);
    expect(mesh.textureSide).toHaveLength(mesh.positions.length / 3);
    expect(mesh.regionIds).toHaveLength(mesh.positions.length / 3);
    expect(mesh.indices.length % 3).toBe(0);
    expect(mesh.constraints.filter((constraint) => constraint.kind === "seam").length)
      .toBeGreaterThan(80);
    expect(mesh.regions?.map((region) => region.kind)).toEqual(
      expect.arrayContaining([
        "torso-front",
        "torso-back",
        "left-sleeve-front",
        "left-sleeve-back",
        "right-sleeve-front",
        "right-sleeve-back",
      ]),
    );
    expect(mesh.positions.every(Number.isFinite)).toBe(true);
  });

  it("splits pants into waistband, left leg, right leg and crotch seams", () => {
    const bodyMesh = makeBodyMesh();
    const front = analyzeAlphaSilhouette(alphaPants());
    const back = analyzeAlphaSilhouette(alphaPants(150, 220));
    const calibration = buildGarmentCalibration(front, back);
    const garment = makeGarment(calibration);
    garment.category = "pants";
    garment.name = "Calça teste";

    const mesh = buildGarmentMesh({ garment, calibration, bodyMesh });
    const kinds = mesh.regions?.map((region) => region.kind) ?? [];

    expect(kinds).toEqual(
      expect.arrayContaining([
        "waist-front",
        "waist-back",
        "left-leg-front",
        "left-leg-back",
        "right-leg-front",
        "right-leg-back",
      ]),
    );
    expect(
      mesh.constraints.filter((constraint) => constraint.kind === "seam").length,
    ).toBeGreaterThan(60);
    expect(mesh.boundsCm.height).toBeGreaterThan(bodyMesh.boundsCm.height * 0.35);
  });

  it("relaxes cloth under gravity while keeping particles outside the BodyMesh", () => {
    const bodyMesh = makeBodyMesh();
    const calibration = calibrationFromProfiles();
    const garment = makeGarment(calibration);
    const mesh = buildGarmentMesh({ garment, calibration, bodyMesh });
    const material = clothMaterialForGarment(garment);
    const before = [...mesh.positions];

    const stats = simulateCloth({
      mesh,
      bodyMesh,
      material,
      steps: 72,
      dt: 1 / 60,
      iterations: 9,
    });

    expect(stats.collisions).toBeGreaterThan(0);
    expect(mesh.positions.every(Number.isFinite)).toBe(true);

    let moved = 0;
    for (let index = 0; index < mesh.positions.length; index += 1) {
      moved = Math.max(moved, Math.abs(mesh.positions[index] - before[index]));
    }
    expect(moved).toBeGreaterThan(0.1);

    for (let particle = 0; particle < mesh.positions.length / 3; particle += 1) {
      const offset = particle * 3;
      const inside = pointInsideExpandedBody(
        bodyMesh,
        mesh.positions[offset],
        mesh.positions[offset + 1],
        mesh.positions[offset + 2],
        material.thicknessCm * 0.98,
      );
      expect(inside).toBe(false);
    }
  });

  it("separates nearby non-neighbor particles with spatial-hash self-collision", () => {
    const calibration = calibrationFromProfiles();
    const garment = makeGarment(calibration);
    const material = clothMaterialForGarment(garment);
    const mesh: GarmentMesh = {
      version: 1,
      coordinateSystem: "x-right-y-up-z-front-centimeters",
      category: "top",
      rows: 1,
      cols: 2,
      panelVertexCount: 2,
      positions: [0, 0, 0, 0.1, 0, 0],
      previousPositions: [0, 0, 0, 0.1, 0, 0],
      inverseMass: [1, 1],
      uv: [0, 0, 1, 0],
      indices: [],
      constraints: [],
      boundsCm: { width: 0.1, height: 0, depth: 0 },
    };

    const collisions = solveGarmentSelfCollisions(mesh, material);
    const distance = Math.hypot(
      mesh.positions[3] - mesh.positions[0],
      mesh.positions[4] - mesh.positions[1],
      mesh.positions[5] - mesh.positions[2],
    );

    expect(collisions).toBe(1);
    expect(distance).toBeGreaterThanOrEqual(material.thicknessCm * 2.15 - 1e-6);
  });

  it("maps heavier fabrics to stiffer bending and thicker collision", () => {
    const calibration = calibrationFromProfiles();
    const light = makeGarment(calibration);
    light.fabricWeight = "light";
    const heavy = makeGarment(calibration);
    heavy.fabricWeight = "heavy";

    const lightMaterial = clothMaterialForGarment(light);
    const heavyMaterial = clothMaterialForGarment(heavy);

    expect(heavyMaterial.bendCompliance).toBeLessThan(lightMaterial.bendCompliance);
    expect(heavyMaterial.thicknessCm).toBeGreaterThan(lightMaterial.thicknessCm);
  });
  it("maps measured fabric data to anisotropic XPBD material and particle mass", () => {
    const calibration = calibrationFromProfiles();
    const garment = makeGarment(calibration);
    garment.physicalProfile = {
      densityGsm: 360,
      thicknessMm: 1.2,
      stretchWarpPct: 4,
      stretchWeftPct: 30,
      bendStiffness: 82,
      friction: 0.31,
    };

    const material = clothMaterialForGarment(garment);
    const mesh = buildGarmentMesh({
      garment,
      calibration,
      bodyMesh: makeBodyMesh(),
    });

    expect(material.stretchWarpCompliance).toBeLessThan(
      material.stretchWeftCompliance ?? 0,
    );
    expect(material.particleInverseMass).toBeLessThan(1);
    expect(material.thicknessCm).toBeCloseTo(0.12, 4);
    expect(material.friction).toBeCloseTo(0.31, 4);
    expect(new Set(mesh.inverseMass)).toEqual(
      new Set([material.particleInverseMass ?? 1]),
    );

    const structuralAxes = new Set(
      mesh.constraints
        .filter((constraint) => constraint.kind === "structural")
        .map((constraint) => constraint.axis),
    );
    expect(structuralAxes).toEqual(new Set(["warp", "weft"]));
  });

  it("lets high-stretch weft relax less aggressively than low-stretch warp", () => {
    const calibration = calibrationFromProfiles();
    const garment = makeGarment(calibration);
    garment.physicalProfile = {
      densityGsm: 180,
      thicknessMm: 0.8,
      stretchWarpPct: 2,
      stretchWeftPct: 35,
      bendStiffness: 55,
      friction: 0.1,
    };
    const material = {
      ...clothMaterialForGarment(garment),
      gravityCmPerSec2: 0,
    };
    const bodyMesh = makeBodyMesh();

    function pairMesh(axis: "warp" | "weft"): GarmentMesh {
      return {
        version: 2,
        coordinateSystem: "x-right-y-up-z-front-centimeters",
        category: "top",
        rows: 1,
        cols: 2,
        panelVertexCount: 2,
        positions: [100, 0, 0, 102, 0, 0],
        previousPositions: [100, 0, 0, 102, 0, 0],
        inverseMass: [0, 1],
        uv: [0, 0, 1, 0],
        indices: [],
        constraints: [
          {
            kind: "structural",
            axis,
            a: 0,
            b: 1,
            restLength: 1,
            lambda: 0,
          },
        ],
        boundsCm: { width: 2, height: 0, depth: 0 },
      };
    }

    const warpMesh = pairMesh("warp");
    const weftMesh = pairMesh("weft");

    simulateCloth({
      mesh: warpMesh,
      bodyMesh,
      material,
      steps: 1,
      dt: 1 / 60,
      iterations: 1,
    });
    simulateCloth({
      mesh: weftMesh,
      bodyMesh,
      material,
      steps: 1,
      dt: 1 / 60,
      iterations: 1,
    });

    const warpLength = Math.abs(warpMesh.positions[3] - warpMesh.positions[0]);
    const weftLength = Math.abs(weftMesh.positions[3] - weftMesh.positions[0]);
    expect(weftLength).toBeGreaterThan(warpLength);
  });

  it("keeps preset fabric profiles available for legacy/simple input", () => {
    const light = defaultFabricPhysicalProfile("light", "low");
    const heavy = defaultFabricPhysicalProfile("heavy", "low");

    expect(heavy.densityGsm).toBeGreaterThan(light.densityGsm);
    expect(heavy.thicknessMm).toBeGreaterThan(light.thicknessMm);
    expect(heavy.bendStiffness).toBeGreaterThan(light.bendStiffness);
  });

});
