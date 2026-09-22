import { describe, expect, it } from "vitest";
import {
  applyMetricViewCalibration,
  detectBodyViewCalibration,
} from "../src/lib/mirro/body-camera-calibration";
import type { RgbaImage } from "../src/lib/mirro/body-calibration";
import type { BodySilhouette } from "../src/lib/mirro/types";

function syntheticTarget(): RgbaImage {
  const width = 210;
  const height = 297;
  const data = new Uint8ClampedArray(width * height * 4);

  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const offset = pixel * 4;
    data[offset] = 250;
    data[offset + 1] = 250;
    data[offset + 2] = 250;
    data[offset + 3] = 255;
  }

  const markers = [
    { center: [26, 26], rgb: [214, 0, 143] },
    { center: [184, 26], rgb: [0, 166, 214] },
    { center: [26, 271], rgb: [246, 200, 0] },
    { center: [184, 271], rgb: [64, 84, 255] },
  ] as const;

  for (const marker of markers) {
    for (let y = marker.center[1] - 8; y <= marker.center[1] + 8; y += 1) {
      for (let x = marker.center[0] - 8; x <= marker.center[0] + 8; x += 1) {
        const offset = (y * width + x) * 4;
        data[offset] = marker.rgb[0];
        data[offset + 1] = marker.rgb[1];
        data[offset + 2] = marker.rgb[2];
        data[offset + 3] = 255;
      }
    }
  }

  return { width, height, data };
}

describe("body metric target", () => {
  it("recovers pixels-per-centimeter and orientation from the printable A4 target", () => {
    const calibration = detectBodyViewCalibration(syntheticTarget());

    expect(calibration).not.toBeNull();
    expect(calibration?.pixelsPerCm).toBeCloseTo(10, 1);
    expect(calibration?.rollRadians).toBeCloseTo(0, 4);
    expect(calibration?.perspectiveSkew).toBeLessThan(0.02);
    expect(calibration?.score).toBeGreaterThan(0.95);
  });

  it("converts normalized silhouette widths into observed centimeters", () => {
    const calibration = detectBodyViewCalibration(syntheticTarget());
    if (!calibration) throw new Error("target not detected");

    const silhouette: BodySilhouette = {
      sourceWidth: 300,
      sourceHeight: 400,
      bounds: { x: 50, y: 100, width: 120, height: 200 },
      widthProfile: [0.2, 0.3, 0.4],
      foregroundRatio: 0.25,
      backgroundThreshold: 40,
      confidence: 0.9,
    };

    const metric = applyMetricViewCalibration(silhouette, calibration);

    expect(metric.metricBodyHeightCm).toBeCloseTo(20, 1);
    expect(metric.metricWidthProfileCm?.[0]).toBeCloseTo(4, 1);
    expect(metric.metricWidthProfileCm?.[2]).toBeCloseTo(8, 1);
    expect(metric.viewCalibration?.method).toBe("mirro-a4-color-target-v1");
  });
});
