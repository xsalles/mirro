import { describe, expect, it } from "vitest";
import { parabolicSubpixelCorrection } from "../src/lib/mirro/body-mvs";

describe("MVS subpixel parabola", () => {
  it("recovers a bounded subpixel maximum between discrete depth samples", () => {
    const step = 0.2;
    const optimum = 0.07;
    const score = (x: number) =>
      1 - 2.5 * (x - optimum) ** 2;

    const correction =
      parabolicSubpixelCorrection(
        score(-step),
        score(0),
        score(step),
        step,
      );

    expect(correction).toBeCloseTo(optimum, 5);
    expect(Math.abs(correction)).toBeLessThanOrEqual(
      step,
    );
  });

  it("refuses convex or flat score triplets", () => {
    expect(
      parabolicSubpixelCorrection(
        0.8,
        0.7,
        0.8,
        0.2,
      ),
    ).toBe(0);
    expect(
      parabolicSubpixelCorrection(
        0.7,
        0.7,
        0.7,
        0.2,
      ),
    ).toBe(0);
  });
});
