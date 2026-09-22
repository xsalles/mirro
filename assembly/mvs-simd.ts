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
