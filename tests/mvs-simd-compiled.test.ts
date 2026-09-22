import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type SimdExports = {
  dot4(
    a0: number,
    a1: number,
    a2: number,
    a3: number,
    b0: number,
    b1: number,
    b2: number,
    b3: number,
  ): number;
  sumSquares4(
    a0: number,
    a1: number,
    a2: number,
    a3: number,
  ): number;
  weightedSum4(
    d0: number,
    d1: number,
    d2: number,
    d3: number,
    w0: number,
    w1: number,
    w2: number,
    w3: number,
  ): number;
  sum4(
    a0: number,
    a1: number,
    a2: number,
    a3: number,
  ): number;
  zncc9(...values: number[]): number;
  stddev9(...values: number[]): number;
  weightedMean8(...values: number[]): number;
  weightSum8(...values: number[]): number;
};

describe("compiled MVS SIMD wasm", () => {
  it("validates and executes vector reductions", async () => {
    const bytes = readFileSync(
      resolve(process.cwd(), "public/mvs-simd.wasm"),
    );

    expect(WebAssembly.validate(bytes)).toBe(true);

    const instance = await WebAssembly.instantiate(
      bytes,
      {},
    );
    const exports =
      instance.instance.exports as unknown as SimdExports;

    expect(
      exports.dot4(
        1, 2, 3, 4,
        5, 6, 7, 8,
      ),
    ).toBeCloseTo(70, 5);

    expect(
      exports.sumSquares4(1, 2, 3, 4),
    ).toBeCloseTo(30, 5);

    expect(
      exports.weightedSum4(
        1, 2, 3, 4,
        0.5, 1, 0.25, 2,
      ),
    ).toBeCloseTo(11.25, 5);

    expect(
      exports.sum4(0.5, 1, 0.25, 2),
    ).toBeCloseTo(3.75, 5);

    const a = [13, 22, 38, 51, 69, 87, 106, 122, 141];
    const b = [15, 24, 36, 54, 67, 91, 103, 126, 139];
    expect(exports.zncc9(...a, ...b)).toBeGreaterThan(0.98);
    expect(exports.stddev9(...a)).toBeGreaterThan(35);

    const depths = [1, 2, 3, 4, 0, 0, 0, 0];
    const weights = [1, 1, 2, 0, 0, 0, 0, 0];
    expect(
      exports.weightedMean8(...depths, ...weights),
    ).toBeCloseTo(2.25, 5);
    expect(
      exports.weightSum8(...weights),
    ).toBeCloseTo(4, 5);
  });
});
