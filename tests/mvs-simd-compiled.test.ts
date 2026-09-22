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
  });
});
