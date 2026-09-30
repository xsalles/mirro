import { describe, expect, it } from "vitest";
import {
  rotateAroundAxis,
  solveTurntableBundle,
  type TurntableBundleView,
} from "../src/lib/mirro/turntable-bundle";
import {
  BODY_VIEW_ANGLE_RAD,
  BODY_VIEW_SEQUENCE,
} from "../src/lib/mirro/body-views";

describe("turntable bundle v10", () => {
  it("recovers angle errors and a tilted rotation axis from centerline observations", () => {
    const origin: [number, number, number] = [
      1.8,
      0,
      -1.2,
    ];
    const direction: [number, number, number] = [
      Math.tan((1.6 * Math.PI) / 180),
      1,
      Math.tan((-1.1 * Math.PI) / 180),
    ];
    const angleOffsets = Object.fromEntries(
      BODY_VIEW_SEQUENCE.map((view, index) => [
        view,
        index === 0
          ? 0
          : ((index % 2 === 0 ? 0.7 : -0.55) *
              Math.PI) /
            180,
      ]),
    );
    const opticalX = 0.9;
    const opticalY = -0.6;

    const views: TurntableBundleView[] =
      BODY_VIEW_SEQUENCE.map((view) => ({
        view,
        nominalAngleRad: BODY_VIEW_ANGLE_RAD[view],
        samples: [-22, -12, 0, 12, 22].map(
          (bodyYcm) => {
            const point = rotateAroundAxis(
              [0, bodyYcm, 0],
              origin,
              direction,
              -(
                BODY_VIEW_ANGLE_RAD[view] +
                angleOffsets[view]
              ),
            );
            return {
              bodyYcm,
              observedHorizontalCm:
                point[0] + opticalX,
              observedVerticalCm:
                point[1] - opticalY,
            };
          },
        ),
      }));

    const solved = solveTurntableBundle({
      views,
      initialAxisCenterCm: [1.2, -0.8],
      maxIterations: 8,
    });

    expect(solved.residualCm).toBeLessThan(0.55);
    expect(solved.axisOriginCm[0]).toBeCloseTo(
      origin[0],
      0,
    );
    expect(solved.axisOriginCm[2]).toBeCloseTo(
      origin[2],
      0,
    );
    expect(solved.axisTiltDeg).toBeGreaterThan(1);
    expect(solved.axisTiltDeg).toBeLessThan(2.8);
    expect(
      Math.abs(
        solved.angleOffsetsRad.right -
          angleOffsets.right,
      ),
    ).toBeLessThan((1.1 * Math.PI) / 180);
  });
  it("uses feature residuals, validates the vertical axis and rejects one bad frame", () => {
    const outlier = "backRight" as const;
    const views: TurntableBundleView[] =
      BODY_VIEW_SEQUENCE.map((view) => ({
        view,
        nominalAngleRad: BODY_VIEW_ANGLE_RAD[view],
        frameConfidence: 0.95,
        samples: [-24, -12, 0, 12, 24].map(
          (bodyYcm) => {
            const horizontalBias =
              view === outlier ? 7.5 : 0;
            const featureBias =
              view === outlier ? 8.2 : 0;
            return {
              bodyYcm,
              observedHorizontalCm: horizontalBias,
              observedVerticalCm: bodyYcm - 0.8,
              featureHorizontalCm: featureBias,
              featureConfidence: 0.9,
            };
          },
        ),
      }));

    const solved = solveTurntableBundle({
      views,
      initialAxisCenterCm: [0, 0],
      maxIterations: 7,
    });

    expect(solved.acceptedViews).toHaveLength(7);
    expect(solved.rejectedViews).toContain(outlier);
    expect(solved.featureResidualCm).toBeGreaterThan(0);
    expect(
      solved.axisVerticalValidation.valid,
    ).toBe(true);
    expect(
      Math.abs(
        solved.axisVerticalValidation
          .residualSlopeCmPerCm,
      ),
    ).toBeLessThan(0.01);
  });

});
