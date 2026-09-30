import type { BodyProfile, GarmentCategory } from "./types";

export type FitBox = {
  xPct: number;
  yPct: number;
  widthPct: number;
  heightPct: number;
};

const TOPS = new Set<GarmentCategory>([
  "top",
  "shirt",
  "hoodie",
  "jacket",
]);

export function fitGarment(
  profile: BodyProfile,
  category: GarmentCategory,
  aspectRatio = 1,
): FitBox {
  const torsoRatio = Math.min(
    0.46,
    Math.max(
      0.26,
      (profile.chestCm / profile.heightCm) * 0.72,
    ),
  );
  const hipRatio = Math.min(
    0.44,
    Math.max(
      0.25,
      (profile.hipsCm / profile.heightCm) * 0.65,
    ),
  );

  if (category === "dress") {
    const widthPct =
      Math.max(torsoRatio, hipRatio) * 100 * 1.08;
    return {
      xPct: 50 - widthPct / 2,
      yPct: 19,
      widthPct,
      heightPct: 64,
    };
  }

  if (TOPS.has(category)) {
    const widthPct =
      torsoRatio *
      100 *
      (category === "jacket"
        ? 1.18
        : category === "hoodie"
          ? 1.14
          : category === "shirt"
            ? 1.08
            : 1.02);
    const naturalHeight =
      widthPct /
      Math.max(0.55, Math.min(aspectRatio, 1.8));
    return {
      xPct: 50 - widthPct / 2,
      yPct:
        category === "hoodie" ||
        category === "jacket"
          ? 19
          : 20.5,
      widthPct,
      heightPct: Math.min(
        category === "jacket" ? 46 : 42,
        Math.max(24, naturalHeight),
      ),
    };
  }

  if (category === "skirt") {
    const widthPct = hipRatio * 100 * 1.06;
    return {
      xPct: 50 - widthPct / 2,
      yPct: 46,
      widthPct,
      heightPct: 36,
    };
  }

  const widthPct =
    hipRatio *
    100 *
    (category === "shorts" ? 1.02 : 0.98);
  const naturalHeight =
    widthPct /
    Math.max(0.45, Math.min(aspectRatio, 1.7));
  return {
    xPct: 50 - widthPct / 2,
    yPct: 48,
    widthPct,
    heightPct:
      category === "shorts"
        ? Math.min(
            25,
            Math.max(16, naturalHeight),
          )
        : Math.min(
            46,
            Math.max(32, naturalHeight * 1.45),
          ),
  };
}
