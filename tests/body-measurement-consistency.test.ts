import { describe, expect, it } from "vitest";
import {
  checkBodyMeasurementConsistency,
  guidedMeasurementCompletion,
} from "../src/lib/mirro/body-measurement-consistency";
import type { BodyMeasurements } from "../src/lib/mirro/types";

const BASE: BodyMeasurements = {
  heightCm: 176,
  chestCm: 98,
  waistCm: 82,
  hipsCm: 100,
  shoulderWidthCm: 44,
  armLengthCm: 61,
  upperArmCm: 33,
  thighCm: 58,
  inseamCm: 82,
  forearmCm: 28,
  calfCm: 38,
  neckCm: 39,
  shoulderSlopeDeg: 9,
};

describe("body measurement consistency", () => {
  it("keeps plausible complete measurements clean", () => {
    expect(
      checkBodyMeasurementConsistency(BASE),
    ).toEqual([]);

    expect(
      guidedMeasurementCompletion(BASE),
    ).toEqual({
      completed: 4,
      total: 4,
    });
  });

  it("flags forearm and calf values that likely need remeasurement", () => {
    const issues = checkBodyMeasurementConsistency({
      ...BASE,
      forearmCm: 40,
      calfCm: 64,
    });

    expect(
      issues.map((issue) => issue.id),
    ).toEqual(
      expect.arrayContaining([
        "forearm-vs-upper-arm",
        "calf-vs-thigh",
      ]),
    );
    expect(
      issues.every(
        (issue) => issue.severity === "review",
      ),
    ).toBe(true);
  });

  it("uses cross-measurement ratios only when both measurements exist", () => {
    const issues = checkBodyMeasurementConsistency({
      heightCm: 176,
      chestCm: 98,
      waistCm: 82,
      hipsCm: 100,
      forearmCm: 50,
      calfCm: 62,
      neckCm: 39,
    });

    expect(
      issues.map((issue) => issue.id),
    ).not.toEqual(
      expect.arrayContaining([
        "forearm-vs-upper-arm",
        "forearm-ratio",
        "calf-vs-thigh",
        "calf-ratio",
      ]),
    );
  });

  it("flags scale relationships without turning them into blocking errors", () => {
    const issues = checkBodyMeasurementConsistency({
      ...BASE,
      shoulderWidthCm: 65,
      armLengthCm: 35,
      inseamCm: 110,
      neckCm: 64,
    });

    const ids = issues.map((issue) => issue.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "shoulders-vs-height",
        "arm-length-vs-height",
        "inseam-vs-height",
      ]),
    );
    expect(
      issues.every((issue) =>
        ["review", "info"].includes(issue.severity),
      ),
    ).toBe(true);
  });

  it("treats a steep shoulder angle as a confirmation hint, not an invalid body", () => {
    const issues = checkBodyMeasurementConsistency({
      ...BASE,
      shoulderSlopeDeg: 21,
    });

    expect(issues).toContainEqual(
      expect.objectContaining({
        id: "shoulder-slope-high",
        severity: "info",
        fields: ["shoulderSlopeDeg"],
      }),
    );
  });

  it("tracks the four guided fields independently from legacy optional measurements", () => {
    expect(
      guidedMeasurementCompletion({
        heightCm: 176,
        chestCm: 98,
        waistCm: 82,
        hipsCm: 100,
        forearmCm: 28,
        neckCm: 39,
      }),
    ).toEqual({
      completed: 2,
      total: 4,
    });
  });
});
