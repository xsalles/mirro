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

let simdExports: SimdExports | null = null;
let hotPathEnabled = false;
let benchmarkRatio: number | null = null;
let initialization:
  | Promise<
      | "wasm-simd-hotpath-v2"
      | "js-scalar"
    >
  | null = null;

function jsPatchStatistics(
  a: number[],
  b: number[],
) {
  const length = Math.min(a.length, b.length);
  if (!length) {
    return { zncc: 0, textureEnergy: 0 };
  }

  let sumA = 0;
  let sumB = 0;
  let dot = 0;
  let squareA = 0;
  let squareB = 0;

  for (let index = 0; index < length; index += 1) {
    const av = a[index];
    const bv = b[index];
    sumA += av;
    sumB += bv;
    dot += av * bv;
    squareA += av * av;
    squareB += bv * bv;
  }

  const meanA = sumA / length;
  const meanB = sumB / length;
  const covariance =
    dot - length * meanA * meanB;
  const varianceA = Math.max(
    0,
    squareA - length * meanA * meanA,
  );
  const varianceB = Math.max(
    0,
    squareB - length * meanB * meanB,
  );
  const denominator = Math.sqrt(
    varianceA * varianceB,
  );

  return {
    zncc:
      denominator > 36
        ? Math.max(
            -1,
            Math.min(1, covariance / denominator),
          )
        : 0,
    textureEnergy: Math.sqrt(
      varianceA / Math.max(1, length),
    ),
  };
}

function runHotPathBenchmark(exports: SimdExports) {
  if (
    typeof performance === "undefined" ||
    typeof performance.now !== "function"
  ) {
    return { enabled: true, ratio: 1 };
  }

  const a = [
    13, 22, 38, 51, 69, 87, 106, 122, 141,
  ];
  const b = [
    15, 24, 36, 54, 67, 91, 103, 126, 139,
  ];
  const iterations = 2400;
  let sink = 0;

  for (let warmup = 0; warmup < 120; warmup += 1) {
    sink += exports.zncc9(...a, ...b);
    sink += jsPatchStatistics(a, b).zncc;
  }

  const jsStart = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    sink += jsPatchStatistics(a, b).zncc;
  }
  const jsMs = Math.max(
    0.01,
    performance.now() - jsStart,
  );

  const wasmStart = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    sink += exports.zncc9(...a, ...b);
  }
  const wasmMs = Math.max(
    0.01,
    performance.now() - wasmStart,
  );

  if (!Number.isFinite(sink)) {
    return { enabled: false, ratio: Infinity };
  }

  const ratio = wasmMs / jsMs;
  return {
    enabled: ratio <= 1.15,
    ratio,
  };
}

export async function initializeMvsSimdKernel() {
  if (simdExports && hotPathEnabled) {
    return "wasm-simd-hotpath-v2" as const;
  }
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
        typeof exports.sum4 !== "function" ||
        typeof exports.zncc9 !== "function" ||
        typeof exports.stddev9 !== "function" ||
        typeof exports.weightedMean8 !== "function" ||
        typeof exports.weightSum8 !== "function"
      ) {
        return "js-scalar" as const;
      }

      simdExports = exports as SimdExports;
      const benchmark = runHotPathBenchmark(
        simdExports,
      );
      hotPathEnabled = benchmark.enabled;
      benchmarkRatio = benchmark.ratio;

      return hotPathEnabled
        ? ("wasm-simd-hotpath-v2" as const)
        : ("js-scalar" as const);
    } catch {
      simdExports = null;
      hotPathEnabled = false;
      benchmarkRatio = null;
      return "js-scalar" as const;
    }
  })();

  return initialization;
}

export function getMvsNumericBackend() {
  return simdExports && hotPathEnabled
    ? ("wasm-simd-hotpath-v2" as const)
    : ("js-scalar" as const);
}

export function getMvsSimdBenchmarkRatio() {
  return benchmarkRatio;
}

export function patchStatistics(
  a: number[],
  b: number[],
) {
  if (
    simdExports &&
    hotPathEnabled &&
    a.length === 9 &&
    b.length === 9
  ) {
    return {
      zncc: simdExports.zncc9(...a, ...b),
      textureEnergy: simdExports.stddev9(...a),
    };
  }

  return jsPatchStatistics(a, b);
}

export function dotProduct(
  a: number[],
  b: number[],
) {
  const length = Math.min(a.length, b.length);
  let sum = 0;
  let index = 0;

  if (simdExports && hotPathEnabled) {
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

  if (simdExports && hotPathEnabled) {
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
  requestedLength?: number,
) {
  const length = Math.min(
    requestedLength ?? values.length,
    values.length,
    weights.length,
  );

  if (
    simdExports &&
    hotPathEnabled &&
    length > 0 &&
    length <= 8
  ) {
    const v = new Array<number>(8).fill(0);
    const w = new Array<number>(8).fill(0);
    for (let index = 0; index < length; index += 1) {
      v[index] = values[index];
      w[index] = weights[index];
    }
    const weightSum = simdExports.weightSum8(...w);
    return {
      value:
        weightSum > 0
          ? simdExports.weightedMean8(
              ...v,
              ...w,
            )
          : 0,
      weightSum,
    };
  }

  let weighted = 0;
  let weightSum = 0;
  let index = 0;

  if (simdExports && hotPathEnabled) {
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
    value:
      weightSum > 0 ? weighted / weightSum : 0,
    weightSum,
  };
}
