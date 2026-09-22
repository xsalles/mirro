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

let simdExports: SimdExports | null = null;
let initialization:
  | Promise<"wasm-simd-v1" | "js-scalar">
  | null = null;

export async function initializeMvsSimdKernel() {
  if (simdExports) return "wasm-simd-v1" as const;
  if (initialization) return initialization;

  initialization = (async () => {
    try {
      if (
        typeof WebAssembly === "undefined" ||
        typeof fetch === "undefined"
      ) {
        return "js-scalar" as const;
      }

      const response = await fetch("/mvs-simd.wasm", {
        cache: "force-cache",
      });
      if (!response.ok) {
        return "js-scalar" as const;
      }

      const bytes = await response.arrayBuffer();
      if (!WebAssembly.validate(bytes)) {
        return "js-scalar" as const;
      }

      const instance = await WebAssembly.instantiate(
        bytes,
        {},
      );
      const exports =
        instance.instance.exports as unknown as Partial<SimdExports>;

      if (
        typeof exports.dot4 !== "function" ||
        typeof exports.sumSquares4 !== "function" ||
        typeof exports.weightedSum4 !== "function" ||
        typeof exports.sum4 !== "function"
      ) {
        return "js-scalar" as const;
      }

      simdExports = exports as SimdExports;
      return "wasm-simd-v1" as const;
    } catch {
      return "js-scalar" as const;
    }
  })();

  return initialization;
}

export function getMvsNumericBackend() {
  return simdExports
    ? ("wasm-simd-v1" as const)
    : ("js-scalar" as const);
}

export function dotProduct(
  a: number[],
  b: number[],
) {
  const length = Math.min(a.length, b.length);
  let sum = 0;
  let index = 0;

  if (simdExports) {
    for (; index + 3 < length; index += 4) {
      sum += simdExports.dot4(
        a[index],
        a[index + 1],
        a[index + 2],
        a[index + 3],
        b[index],
        b[index + 1],
        b[index + 2],
        b[index + 3],
      );
    }
  }

  for (; index < length; index += 1) {
    sum += a[index] * b[index];
  }
  return sum;
}

export function sumSquares(values: number[]) {
  let sum = 0;
  let index = 0;

  if (simdExports) {
    for (; index + 3 < values.length; index += 4) {
      sum += simdExports.sumSquares4(
        values[index],
        values[index + 1],
        values[index + 2],
        values[index + 3],
      );
    }
  }

  for (; index < values.length; index += 1) {
    sum += values[index] * values[index];
  }
  return sum;
}

export function weightedMean(
  values: number[],
  weights: number[],
) {
  const length = Math.min(
    values.length,
    weights.length,
  );
  let weighted = 0;
  let weightSum = 0;
  let index = 0;

  if (simdExports) {
    for (; index + 3 < length; index += 4) {
      weighted += simdExports.weightedSum4(
        values[index],
        values[index + 1],
        values[index + 2],
        values[index + 3],
        weights[index],
        weights[index + 1],
        weights[index + 2],
        weights[index + 3],
      );
      weightSum += simdExports.sum4(
        weights[index],
        weights[index + 1],
        weights[index + 2],
        weights[index + 3],
      );
    }
  }

  for (; index < length; index += 1) {
    weighted += values[index] * weights[index];
    weightSum += weights[index];
  }

  return {
    value: weightSum > 0 ? weighted / weightSum : 0,
    weightSum,
  };
}
