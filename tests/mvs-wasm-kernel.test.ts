import { describe, expect, it } from "vitest";
import {
  censusHamming32,
  getCensusPopcountKernel,
} from "../src/lib/mirro/mvs-wasm-kernel";

describe("MVS WASM Census kernel", () => {
  it("uses WebAssembly popcnt when available and matches Hamming distance", () => {
    const kernel = getCensusPopcountKernel();

    expect(censusHamming32(0, 0)).toBe(0);
    expect(
      censusHamming32(0xffffffff, 0),
    ).toBe(32);
    expect(
      censusHamming32(
        0b1010101010101010,
        0b0101010101010101,
      ),
    ).toBe(16);

    if (typeof WebAssembly !== "undefined") {
      expect(kernel.backend).toBe(
        "wasm-popcnt32-v1",
      );
    }
  });
});
