import { describe, expect, it } from "vitest";
import {
  buildSurfaceAccuracyReport,
  summarizeSurfaceAccuracyEvidence,
} from "../src/lib/mirro/surface-accuracy";

function passingReport(
  datasetId: string,
  source: "synthetic" | "real-calibrated",
) {
  return buildSurfaceAccuracyReport({
    datasetId,
    source,
    errorsCm: [
      -0.8, -0.4, -0.2, 0, 0.1, 0.2, 0.35, 0.5,
      0.6, 0.8, -0.7, 0.3, 0.15, -0.25, 0.45, 0.7,
      -0.1, 0.05, 0.2, -0.3, 0.4, 0.55, -0.45, 0.25,
    ],
  });
}

describe("surface accuracy evidence", () => {
  it("computes robust absolute and signed error metrics", () => {
    const report = buildSurfaceAccuracyReport({
      datasetId: "synthetic-balanced",
      source: "synthetic",
      errorsCm: [-2, -1, 0, 1, 2],
      thresholds: {
        maxRmseCm: 2,
        maxP95Cm: 2,
        maxAbsBiasCm: 0.1,
        minCoverage: 1,
        minSampleCount: 5,
      },
    });

    expect(report.metrics.meanAbsoluteErrorCm).toBeCloseTo(
      1.2,
      6,
    );
    expect(report.metrics.rmseCm).toBeCloseTo(
      Math.sqrt(2),
      6,
    );
    expect(report.metrics.signedBiasCm).toBeCloseTo(
      0,
      6,
    );
    expect(report.metrics.p95AbsoluteErrorCm).toBeCloseTo(
      2,
      6,
    );
    expect(report.passed).toBe(true);
  });

  it("keeps the depth-grid cap locked until real calibrated evidence exists", () => {
    const synthetic = Array.from(
      { length: 8 },
      (_, index) =>
        passingReport(
          `synthetic-view-${index + 1}`,
          "synthetic",
        ),
    );

    const summary =
      summarizeSurfaceAccuracyEvidence(synthetic);

    expect(summary.syntheticDatasets).toBe(8);
    expect(summary.realCalibratedDatasets).toBe(0);
    expect(summary.failedDatasets).toBe(0);
    expect(summary.canRaiseDepthGridCap).toBe(false);
    expect(
      summary.blockers.some((blocker) =>
        blocker.includes("real calibrated"),
      ),
    ).toBe(true);
  });

  it("opens the evidence gate only when synthetic and real datasets all pass", () => {
    const reports = [
      ...Array.from({ length: 6 }, (_, index) =>
        passingReport(
          `synthetic-${index + 1}`,
          "synthetic",
        ),
      ),
      ...Array.from({ length: 3 }, (_, index) =>
        passingReport(
          `real-${index + 1}`,
          "real-calibrated",
        ),
      ),
    ];

    const summary =
      summarizeSurfaceAccuracyEvidence(reports);

    expect(summary.canRaiseDepthGridCap).toBe(true);
    expect(summary.blockers).toEqual([]);
  });

  it("fails biased or insufficient datasets explicitly", () => {
    const report = buildSurfaceAccuracyReport({
      datasetId: "bad-bias",
      source: "real-calibrated",
      errorsCm: new Array(24).fill(3.2),
    });

    expect(report.passed).toBe(false);
    expect(report.failures.join(" ")).toContain("bias");
    expect(report.failures.join(" ")).toContain("rmse");
  });
});
