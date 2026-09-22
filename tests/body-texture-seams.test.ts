import { describe, expect, it } from "vitest";
import { optimizeGradientDomainSeams } from "../src/lib/mirro/body-texture-atlas";

function makeImage(width: number, height: number) {
  return new Uint8ClampedArray(width * height * 4);
}

describe("gradient-domain seam optimization", () => {
  it("smooths a seam while preserving non-seam pixels", () => {
    const width = 32;
    const height = 8;
    const base = makeImage(width, height);
    const guidance = makeImage(width, height);
    const seamMask = new Uint8Array(width * height);

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4;
        const value = x < width / 2 ? 82 : 172;
        base[offset] = value;
        base[offset + 1] = value;
        base[offset + 2] = value;
        base[offset + 3] = 255;

        const guide = 124 + Math.round((x - width / 2) * 0.8);
        guidance[offset] = guide;
        guidance[offset + 1] = guide;
        guidance[offset + 2] = guide;
        guidance[offset + 3] = 255;

        if (x >= 13 && x <= 18) {
          seamMask[y * width + x] = 1;
        }
      }
    }

    const beforeJump = Math.abs(
      base[(4 * width + 16) * 4] -
        base[(4 * width + 15) * 4],
    );
    const optimized = optimizeGradientDomainSeams({
      base,
      guidance,
      seamMask,
      width,
      height,
      iterations: 20,
      screening: 0.7,
    });
    const afterJump = Math.abs(
      optimized[(4 * width + 16) * 4] -
        optimized[(4 * width + 15) * 4],
    );

    expect(afterJump).toBeLessThan(beforeJump * 0.45);
    expect(optimized[(4 * width + 2) * 4]).toBe(82);
    expect(optimized[(4 * width + 29) * 4]).toBe(172);
  });

  it("treats the 360 atlas as horizontally periodic", () => {
    const width = 20;
    const height = 4;
    const base = makeImage(width, height);
    const guidance = makeImage(width, height);
    const seamMask = new Uint8Array(width * height);

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4;
        const value = x < 2 ? 180 : x > 17 ? 70 : 125;
        base[offset] = value;
        base[offset + 1] = value;
        base[offset + 2] = value;
        base[offset + 3] = 255;
        guidance[offset] = 125;
        guidance[offset + 1] = 125;
        guidance[offset + 2] = 125;
        guidance[offset + 3] = 255;

        if (x <= 2 || x >= 17) {
          seamMask[y * width + x] = 1;
        }
      }
    }

    const optimized = optimizeGradientDomainSeams({
      base,
      guidance,
      seamMask,
      width,
      height,
      iterations: 18,
      screening: 0.8,
    });
    const seamJump = Math.abs(
      optimized[(2 * width) * 4] -
        optimized[(2 * width + width - 1) * 4],
    );

    expect(seamJump).toBeLessThan(55);
  });
});
