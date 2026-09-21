import { describe, expect, it } from "vitest";
import { fitGarment } from "../src/lib/mirro/fit";
import type { BodyProfile } from "../src/lib/mirro/types";

const profile: BodyProfile = {
  heightCm: 178,
  chestCm: 98,
  waistCm: 82,
  hipsCm: 96,
  photos: {},
  updatedAt: new Date(0).toISOString(),
};

describe("fitGarment", () => {
  it("centers tops on the body", () => {
    const box = fitGarment(profile, "top", 1);
    expect(box.xPct + box.widthPct / 2).toBeCloseTo(50, 5);
    expect(box.yPct).toBeGreaterThan(15);
    expect(box.yPct).toBeLessThan(30);
  });

  it("places pants below tops", () => {
    const top = fitGarment(profile, "top", 1);
    const pants = fitGarment(profile, "pants", 0.8);
    expect(pants.yPct).toBeGreaterThan(top.yPct);
    expect(pants.heightPct).toBeGreaterThan(30);
  });
});
