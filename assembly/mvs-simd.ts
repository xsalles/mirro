function pack4(
  a: f32,
  b: f32,
  c: f32,
  d: f32,
): v128 {
  let vector = v128.splat<f32>(a);
  vector = v128.replace_lane<f32>(vector, 1, b);
  vector = v128.replace_lane<f32>(vector, 2, c);
  vector = v128.replace_lane<f32>(vector, 3, d);
  return vector;
}

function horizontalSum(vector: v128): f32 {
  return (
    v128.extract_lane<f32>(vector, 0) +
    v128.extract_lane<f32>(vector, 1) +
    v128.extract_lane<f32>(vector, 2) +
    v128.extract_lane<f32>(vector, 3)
  );
}

export function dot4(
  a0: f32,
  a1: f32,
  a2: f32,
  a3: f32,
  b0: f32,
  b1: f32,
  b2: f32,
  b3: f32,
): f32 {
  const a = pack4(a0, a1, a2, a3);
  const b = pack4(b0, b1, b2, b3);
  return horizontalSum(v128.mul<f32>(a, b));
}

export function sumSquares4(
  a0: f32,
  a1: f32,
  a2: f32,
  a3: f32,
): f32 {
  const a = pack4(a0, a1, a2, a3);
  return horizontalSum(v128.mul<f32>(a, a));
}

export function weightedSum4(
  d0: f32,
  d1: f32,
  d2: f32,
  d3: f32,
  w0: f32,
  w1: f32,
  w2: f32,
  w3: f32,
): f32 {
  const distances = pack4(d0, d1, d2, d3);
  const weights = pack4(w0, w1, w2, w3);
  return horizontalSum(
    v128.mul<f32>(distances, weights),
  );
}

export function sum4(
  a0: f32,
  a1: f32,
  a2: f32,
  a3: f32,
): f32 {
  return horizontalSum(pack4(a0, a1, a2, a3));
}

export function zncc9(
  a0: f32,
  a1: f32,
  a2: f32,
  a3: f32,
  a4: f32,
  a5: f32,
  a6: f32,
  a7: f32,
  a8: f32,
  b0: f32,
  b1: f32,
  b2: f32,
  b3: f32,
  b4: f32,
  b5: f32,
  b6: f32,
  b7: f32,
  b8: f32,
): f32 {
  const av0 = pack4(a0, a1, a2, a3);
  const av1 = pack4(a4, a5, a6, a7);
  const bv0 = pack4(b0, b1, b2, b3);
  const bv1 = pack4(b4, b5, b6, b7);

  const sumA =
    horizontalSum(av0) +
    horizontalSum(av1) +
    a8;
  const sumB =
    horizontalSum(bv0) +
    horizontalSum(bv1) +
    b8;
  const meanA = sumA / 9.0;
  const meanB = sumB / 9.0;

  const dot =
    horizontalSum(v128.mul<f32>(av0, bv0)) +
    horizontalSum(v128.mul<f32>(av1, bv1)) +
    a8 * b8;
  const sumSqA =
    horizontalSum(v128.mul<f32>(av0, av0)) +
    horizontalSum(v128.mul<f32>(av1, av1)) +
    a8 * a8;
  const sumSqB =
    horizontalSum(v128.mul<f32>(bv0, bv0)) +
    horizontalSum(v128.mul<f32>(bv1, bv1)) +
    b8 * b8;

  const covariance = dot - 9.0 * meanA * meanB;
  const varianceA = Mathf.max(
    0.0,
    sumSqA - 9.0 * meanA * meanA,
  );
  const varianceB = Mathf.max(
    0.0,
    sumSqB - 9.0 * meanB * meanB,
  );
  const denominator = Mathf.sqrt(
    varianceA * varianceB,
  );
  if (denominator <= 36.0) return 0.0;
  return Mathf.max(
    -1.0,
    Mathf.min(1.0, covariance / denominator),
  );
}

export function stddev9(
  a0: f32,
  a1: f32,
  a2: f32,
  a3: f32,
  a4: f32,
  a5: f32,
  a6: f32,
  a7: f32,
  a8: f32,
): f32 {
  const av0 = pack4(a0, a1, a2, a3);
  const av1 = pack4(a4, a5, a6, a7);
  const sum =
    horizontalSum(av0) +
    horizontalSum(av1) +
    a8;
  const mean = sum / 9.0;
  const sumSq =
    horizontalSum(v128.mul<f32>(av0, av0)) +
    horizontalSum(v128.mul<f32>(av1, av1)) +
    a8 * a8;
  return Mathf.sqrt(
    Mathf.max(
      0.0,
      sumSq / 9.0 - mean * mean,
    ),
  );
}

export function weightedMean8(
  d0: f32,
  d1: f32,
  d2: f32,
  d3: f32,
  d4: f32,
  d5: f32,
  d6: f32,
  d7: f32,
  w0: f32,
  w1: f32,
  w2: f32,
  w3: f32,
  w4: f32,
  w5: f32,
  w6: f32,
  w7: f32,
): f32 {
  const dA = pack4(d0, d1, d2, d3);
  const dB = pack4(d4, d5, d6, d7);
  const wA = pack4(w0, w1, w2, w3);
  const wB = pack4(w4, w5, w6, w7);
  const weighted =
    horizontalSum(v128.mul<f32>(dA, wA)) +
    horizontalSum(v128.mul<f32>(dB, wB));
  const weight =
    horizontalSum(wA) + horizontalSum(wB);
  return weight > 0.0 ? weighted / weight : 0.0;
}

export function weightSum8(
  w0: f32,
  w1: f32,
  w2: f32,
  w3: f32,
  w4: f32,
  w5: f32,
  w6: f32,
  w7: f32,
): f32 {
  return (
    horizontalSum(pack4(w0, w1, w2, w3)) +
    horizontalSum(pack4(w4, w5, w6, w7))
  );
}
