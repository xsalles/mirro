const WASM_POPCNT32 = Uint8Array.from([
  0x00, 0x61, 0x73, 0x6d,
  0x01, 0x00, 0x00, 0x00,
  0x01, 0x06, 0x01, 0x60, 0x01, 0x7f, 0x01, 0x7f,
  0x03, 0x02, 0x01, 0x00,
  0x07, 0x0c, 0x01, 0x08,
  0x70, 0x6f, 0x70, 0x63, 0x6e, 0x74, 0x33, 0x32,
  0x00, 0x00,
  0x0a, 0x07, 0x01, 0x05, 0x00, 0x20, 0x00, 0x69, 0x0b,
]);

type PopcntExports = {
  popcnt32(value: number): number;
};

let cached:
  | {
      backend: "wasm-popcnt32-v1" | "js-popcnt";
      popcnt32(value: number): number;
    }
  | undefined;

function jsPopcnt32(value: number) {
  let v = value >>> 0;
  v -= (v >>> 1) & 0x55555555;
  v =
    (v & 0x33333333) +
    ((v >>> 2) & 0x33333333);
  return (
    (((v + (v >>> 4)) & 0x0f0f0f0f) *
      0x01010101) >>>
    24
  );
}

export function getCensusPopcountKernel() {
  if (cached) return cached;

  try {
    if (typeof WebAssembly !== "undefined") {
      const module = new WebAssembly.Module(
        WASM_POPCNT32,
      );
      const instance = new WebAssembly.Instance(
        module,
      );
      const exports =
        instance.exports as unknown as PopcntExports;
      if (typeof exports.popcnt32 === "function") {
        cached = {
          backend: "wasm-popcnt32-v1",
          popcnt32(value: number) {
            return exports.popcnt32(value | 0);
          },
        };
        return cached;
      }
    }
  } catch {
    // Fall through to deterministic JavaScript.
  }

  cached = {
    backend: "js-popcnt",
    popcnt32: jsPopcnt32,
  };
  return cached;
}

export function censusHamming32(
  a: number,
  b: number,
) {
  return getCensusPopcountKernel().popcnt32(
    (a ^ b) >>> 0,
  );
}
