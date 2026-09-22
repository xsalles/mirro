import { describe, expect, it } from "vitest";
import { analyzeBodyTextureCalibration } from "../src/lib/mirro/body-texture-calibration";
import type { RgbaImage } from "../src/lib/mirro/body-calibration";
import type { BodySide, BodySilhouette } from "../src/lib/mirro/types";

function makeImage(rgb: [number, number, number]): {
  image: RgbaImage;
  mask: Uint8Array;
  silhouette: BodySilhouette;
} {
  const width = 120;
  const height = 240;
  const data = new Uint8ClampedArray(width * height * 4);
  const mask = new Uint8Array(width * height);

  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const offset = pixel * 4;
    data[offset] = 245;
    data[offset + 1] = 245;
    data[offset + 2] = 245;
    data[offset + 3] = 255;
  }

  for (let y = 20; y < 220; y += 1) {
    for (let x = 35; x < 85; x += 1) {
      const pixel = y * width + x;
      const offset = pixel * 4;
      mask[pixel] = 1;
      data[offset] = rgb[0];
      data[offset + 1] = rgb[1];
      data[offset + 2] = rgb[2];
      data[offset + 3] = 255;
    }
  }

  return {
    image: { width, height, data },
    mask,
    silhouette: {
      sourceWidth: width,
      sourceHeight: height,
      bounds: { x: 35, y: 20, width: 50, height: 200 },
      widthProfile: new Array(64).fill(50 / 200),
      foregroundRatio: 0.35,
      backgroundThreshold: 40,
      confidence: 0.95,
    },
  };
}

describe("body texture exposure calibration", () => {
  it("pulls dark and bright body views toward a shared exposure", () => {
    const source = {
      front: makeImage([150, 120, 105]),
      right: makeImage([95, 78, 70]),
      back: makeImage([188, 152, 132]),
      left: makeImage([125, 101, 90]),
    } satisfies Record<BodySide, ReturnType<typeof makeImage>>;

    const calibration = analyzeBodyTextureCalibration({
      images: Object.fromEntries(
        Object.entries(source).map(([side, value]) => [side, value.image]),
      ) as Record<BodySide, RgbaImage>,
      masks: Object.fromEntries(
        Object.entries(source).map(([side, value]) => [side, value.mask]),
      ) as Record<BodySide, Uint8Array>,
      silhouettes: Object.fromEntries(
        Object.entries(source).map(([side, value]) => [side, value.silhouette]),
      ) as Record<BodySide, BodySilhouette>,
    });

    expect(calibration.method).toBe("log-luminance-rgb-gain-v1");
    expect(calibration.gains.right[0]).toBeGreaterThan(1);
    expect(calibration.gains.back[0]).toBeLessThan(1);
    expect(calibration.score).toBeGreaterThan(0.9);

    const balanced = (side: BodySide) => {
      const gain = calibration.gains[side];
      const mean = calibration.meanLuminance[side];
      return mean * (gain[0] + gain[1] + gain[2]) / 3;
    };

    const values = (["front", "right", "back", "left"] as const).map(balanced);
    expect(Math.max(...values) - Math.min(...values)).toBeLessThan(45);
  });
});
