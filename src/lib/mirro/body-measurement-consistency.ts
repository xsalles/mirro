import type { BodyMeasurements } from "./types";

export type BodyMeasurementConsistencySeverity =
  | "review"
  | "info";

export type BodyMeasurementConsistencyIssue = {
  id: string;
  severity: BodyMeasurementConsistencySeverity;
  fields: Array<keyof BodyMeasurements>;
  message: string;
};

function finitePositive(value: number | undefined) {
  return value !== undefined &&
    Number.isFinite(value) &&
    value > 0;
}

function outsideRatio(params: {
  numerator: number | undefined;
  denominator: number | undefined;
  min: number;
  max: number;
}) {
  if (
    !finitePositive(params.numerator) ||
    !finitePositive(params.denominator)
  ) {
    return false;
  }

  const ratio =
    params.numerator! / params.denominator!;
  return ratio < params.min || ratio > params.max;
}

export function checkBodyMeasurementConsistency(
  measurements: Partial<BodyMeasurements>,
): BodyMeasurementConsistencyIssue[] {
  const issues: BodyMeasurementConsistencyIssue[] = [];

  if (
    finitePositive(measurements.forearmCm) &&
    finitePositive(measurements.upperArmCm) &&
    measurements.forearmCm! >
      measurements.upperArmCm! * 1.05
  ) {
    issues.push({
      id: "forearm-vs-upper-arm",
      severity: "review",
      fields: ["forearmCm", "upperArmCm"],
      message:
        "O antebraço ficou maior que a circunferência do braço. Confira se as duas medidas foram tiradas na parte mais larga e sem apertar a fita.",
    });
  }

  if (
    outsideRatio({
      numerator: measurements.forearmCm,
      denominator: measurements.upperArmCm,
      min: 0.45,
      max: 1.05,
    }) &&
    measurements.forearmCm! <=
      measurements.upperArmCm! * 1.05
  ) {
    issues.push({
      id: "forearm-ratio",
      severity: "review",
      fields: ["forearmCm", "upperArmCm"],
      message:
        "A diferença entre braço e antebraço ficou muito grande. Vale repetir as duas circunferências antes de recalibrar.",
    });
  }

  if (
    finitePositive(measurements.calfCm) &&
    finitePositive(measurements.thighCm) &&
    measurements.calfCm! >
      measurements.thighCm! * 1.05
  ) {
    issues.push({
      id: "calf-vs-thigh",
      severity: "review",
      fields: ["calfCm", "thighCm"],
      message:
        "A panturrilha ficou maior que a circunferência da coxa. Confira se ambas foram medidas no ponto mais largo.",
    });
  }

  if (
    outsideRatio({
      numerator: measurements.calfCm,
      denominator: measurements.thighCm,
      min: 0.45,
      max: 1.05,
    }) &&
    measurements.calfCm! <=
      measurements.thighCm! * 1.05
  ) {
    issues.push({
      id: "calf-ratio",
      severity: "review",
      fields: ["calfCm", "thighCm"],
      message:
        "A diferença entre coxa e panturrilha ficou muito grande. Repita as duas medidas com a fita horizontal.",
    });
  }

  if (
    outsideRatio({
      numerator: measurements.neckCm,
      denominator: measurements.chestCm,
      min: 0.18,
      max: 0.65,
    })
  ) {
    issues.push({
      id: "neck-vs-chest",
      severity: "review",
      fields: ["neckCm", "chestCm"],
      message:
        "Pescoço e tórax ficaram com uma proporção incomum para o mesmo perfil. Confira se o pescoço foi medido na base e o tórax no ponto indicado.",
    });
  }

  if (
    outsideRatio({
      numerator: measurements.shoulderWidthCm,
      denominator: measurements.heightCm,
      min: 0.14,
      max: 0.4,
    })
  ) {
    issues.push({
      id: "shoulders-vs-height",
      severity: "review",
      fields: ["shoulderWidthCm", "heightCm"],
      message:
        "A largura dos ombros ficou muito distante da escala informada pela altura. Confira os dois pontos externos usados na medição.",
    });
  }

  if (
    outsideRatio({
      numerator: measurements.armLengthCm,
      denominator: measurements.heightCm,
      min: 0.18,
      max: 0.48,
    })
  ) {
    issues.push({
      id: "arm-length-vs-height",
      severity: "review",
      fields: ["armLengthCm", "heightCm"],
      message:
        "O comprimento do braço ficou muito distante da escala informada pela altura. Confira se a medida vai do ombro ao punho sem acompanhar a curva do braço.",
    });
  }

  if (
    outsideRatio({
      numerator: measurements.inseamCm,
      denominator: measurements.heightCm,
      min: 0.3,
      max: 0.66,
    })
  ) {
    issues.push({
      id: "inseam-vs-height",
      severity: "review",
      fields: ["inseamCm", "heightCm"],
      message:
        "A entreperna ficou muito distante da escala informada pela altura. Confira o ponto inicial da virilha e mantenha a fita reta até o chão.",
    });
  }

  if (
    measurements.shoulderSlopeDeg !== undefined &&
    Number.isFinite(measurements.shoulderSlopeDeg) &&
    measurements.shoulderSlopeDeg >= 18
  ) {
    issues.push({
      id: "shoulder-slope-high",
      severity: "info",
      fields: ["shoulderSlopeDeg"],
      message:
        "Ângulos altos de ombro são fáceis de inverter ou medir com o celular inclinado. Confirme a linha da base do pescoço até o ponto do ombro antes de salvar.",
    });
  }

  return issues;
}

export function guidedMeasurementCompletion(
  measurements: Partial<BodyMeasurements>,
) {
  const fields: Array<keyof BodyMeasurements> = [
    "forearmCm",
    "calfCm",
    "neckCm",
    "shoulderSlopeDeg",
  ];
  const completed = fields.filter((field) => {
    const value = measurements[field];
    return (
      value !== undefined &&
      Number.isFinite(value)
    );
  }).length;

  return {
    completed,
    total: fields.length,
  };
}
