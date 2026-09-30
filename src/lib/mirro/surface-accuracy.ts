export type SurfaceAccuracySource =
  | "synthetic"
  | "real-calibrated";

export type SurfaceAccuracyThresholds = {
  maxRmseCm: number;
  maxP95Cm: number;
  maxAbsBiasCm: number;
  minCoverage: number;
  minSampleCount: number;
};

export type SurfaceAccuracyEvidencePolicy = {
  minSyntheticDatasets: number;
  minRealCalibratedDatasets: number;
};

export type SurfaceAccuracyMetrics = {
  sampleCount: number;
  expectedSampleCount: number;
  coverage: number;
  meanAbsoluteErrorCm: number;
  rmseCm: number;
  p50AbsoluteErrorCm: number;
  p95AbsoluteErrorCm: number;
  maxAbsoluteErrorCm: number;
  signedBiasCm: number;
};

export type SurfaceAccuracyReport = {
  version: 1;
  datasetId: string;
  source: SurfaceAccuracySource;
  metrics: SurfaceAccuracyMetrics;
  thresholds: SurfaceAccuracyThresholds;
  passed: boolean;
  failures: string[];
};

export type SurfaceAccuracyEvidenceSummary = {
  syntheticDatasets: number;
  realCalibratedDatasets: number;
  passedDatasets: number;
  failedDatasets: number;
  canRaiseDepthGridCap: boolean;
  blockers: string[];
};

export const DEFAULT_SURFACE_ACCURACY_THRESHOLDS: SurfaceAccuracyThresholds = {
  maxRmseCm: 3,
  maxP95Cm: 5,
  maxAbsBiasCm: 2,
  minCoverage: 0.95,
  minSampleCount: 24,
};

export const DEFAULT_SURFACE_ACCURACY_EVIDENCE_POLICY: SurfaceAccuracyEvidencePolicy =
  {
    minSyntheticDatasets: 6,
    minRealCalibratedDatasets: 3,
  };

function percentile(sorted: readonly number[], quantile: number) {
  if (!sorted.length) return Infinity;
  const position =
    Math.min(1, Math.max(0, quantile)) *
    (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];

  const fraction = position - lower;
  return (
    sorted[lower] * (1 - fraction) +
    sorted[upper] * fraction
  );
}

function finiteErrors(errorsCm: readonly number[]) {
  return errorsCm.filter(Number.isFinite);
}

export function buildSurfaceAccuracyReport(params: {
  datasetId: string;
  source: SurfaceAccuracySource;
  errorsCm: readonly number[];
  expectedSampleCount?: number;
  thresholds?: SurfaceAccuracyThresholds;
}): SurfaceAccuracyReport {
  const errors = finiteErrors(params.errorsCm);
  const absolute = errors
    .map((value) => Math.abs(value))
    .sort((a, b) => a - b);
  const expectedSampleCount = Math.max(
    errors.length,
    params.expectedSampleCount ?? errors.length,
  );
  const coverage =
    expectedSampleCount > 0
      ? errors.length / expectedSampleCount
      : 0;

  let absoluteSum = 0;
  let squaredSum = 0;
  let signedSum = 0;
  for (const error of errors) {
    const magnitude = Math.abs(error);
    absoluteSum += magnitude;
    squaredSum += error * error;
    signedSum += error;
  }

  const metrics: SurfaceAccuracyMetrics = {
    sampleCount: errors.length,
    expectedSampleCount,
    coverage,
    meanAbsoluteErrorCm:
      errors.length > 0
        ? absoluteSum / errors.length
        : Infinity,
    rmseCm:
      errors.length > 0
        ? Math.sqrt(squaredSum / errors.length)
        : Infinity,
    p50AbsoluteErrorCm: percentile(absolute, 0.5),
    p95AbsoluteErrorCm: percentile(absolute, 0.95),
    maxAbsoluteErrorCm:
      absolute.length > 0
        ? absolute[absolute.length - 1]
        : Infinity,
    signedBiasCm:
      errors.length > 0
        ? signedSum / errors.length
        : Infinity,
  };

  const thresholds =
    params.thresholds ??
    DEFAULT_SURFACE_ACCURACY_THRESHOLDS;
  const failures: string[] = [];

  if (metrics.sampleCount < thresholds.minSampleCount) {
    failures.push(
      `sample-count ${metrics.sampleCount} < ${thresholds.minSampleCount}`,
    );
  }
  if (metrics.coverage < thresholds.minCoverage) {
    failures.push(
      `coverage ${metrics.coverage.toFixed(3)} < ${thresholds.minCoverage.toFixed(3)}`,
    );
  }
  if (metrics.rmseCm > thresholds.maxRmseCm) {
    failures.push(
      `rmse ${metrics.rmseCm.toFixed(3)} cm > ${thresholds.maxRmseCm.toFixed(3)} cm`,
    );
  }
  if (
    metrics.p95AbsoluteErrorCm >
    thresholds.maxP95Cm
  ) {
    failures.push(
      `p95 ${metrics.p95AbsoluteErrorCm.toFixed(3)} cm > ${thresholds.maxP95Cm.toFixed(3)} cm`,
    );
  }
  if (
    Math.abs(metrics.signedBiasCm) >
    thresholds.maxAbsBiasCm
  ) {
    failures.push(
      `bias ${metrics.signedBiasCm.toFixed(3)} cm outside ±${thresholds.maxAbsBiasCm.toFixed(3)} cm`,
    );
  }

  return {
    version: 1,
    datasetId: params.datasetId,
    source: params.source,
    metrics,
    thresholds,
    passed: failures.length === 0,
    failures,
  };
}

export function summarizeSurfaceAccuracyEvidence(
  reports: readonly SurfaceAccuracyReport[],
  policy: SurfaceAccuracyEvidencePolicy =
    DEFAULT_SURFACE_ACCURACY_EVIDENCE_POLICY,
): SurfaceAccuracyEvidenceSummary {
  const syntheticDatasets = reports.filter(
    (report) => report.source === "synthetic",
  ).length;
  const realCalibratedDatasets = reports.filter(
    (report) => report.source === "real-calibrated",
  ).length;
  const failedDatasets = reports.filter(
    (report) => !report.passed,
  ).length;
  const passedDatasets = reports.length - failedDatasets;
  const blockers: string[] = [];

  if (
    syntheticDatasets < policy.minSyntheticDatasets
  ) {
    blockers.push(
      `need at least ${policy.minSyntheticDatasets} synthetic datasets; have ${syntheticDatasets}`,
    );
  }
  if (
    realCalibratedDatasets <
    policy.minRealCalibratedDatasets
  ) {
    blockers.push(
      `need at least ${policy.minRealCalibratedDatasets} real calibrated datasets; have ${realCalibratedDatasets}`,
    );
  }
  if (failedDatasets > 0) {
    blockers.push(
      `${failedDatasets} accuracy dataset(s) fail the configured thresholds`,
    );
  }

  return {
    syntheticDatasets,
    realCalibratedDatasets,
    passedDatasets,
    failedDatasets,
    canRaiseDepthGridCap: blockers.length === 0,
    blockers,
  };
}
