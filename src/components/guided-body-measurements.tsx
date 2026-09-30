"use client";

import {
  Check,
  CircleAlert,
  Ruler,
} from "lucide-react";
import type { BodyMeasurements } from "@/lib/mirro/types";
import {
  checkBodyMeasurementConsistency,
  guidedMeasurementCompletion,
} from "@/lib/mirro/body-measurement-consistency";

export type BodyMeasurementDraft = Record<
  keyof BodyMeasurements,
  string
>;

type GuidedBodyMeasurementsProps = {
  measurements: BodyMeasurementDraft;
  errors: Record<string, string>;
  onChange: (
    key: keyof BodyMeasurements,
    value: string,
  ) => void;
};

const GUIDED_FIELDS = [
  {
    key: "forearmCm",
    label: "Circunferência do antebraço",
    unit: "cm",
    min: 15,
    max: 55,
    step: 0.1,
    instruction:
      "Deixe o braço relaxado ao lado do corpo e passe a fita pela parte mais larga do antebraço.",
    checkpoint:
      "Fita horizontal, encostando na pele sem comprimir.",
  },
  {
    key: "calfCm",
    label: "Circunferência da panturrilha",
    unit: "cm",
    min: 20,
    max: 70,
    step: 0.1,
    instruction:
      "Fique em pé com o peso distribuído e meça a parte mais larga da panturrilha.",
    checkpoint:
      "Fita paralela ao chão; não meça mais perto do joelho ou tornozelo.",
  },
  {
    key: "neckCm",
    label: "Circunferência do pescoço",
    unit: "cm",
    min: 25,
    max: 65,
    step: 0.1,
    instruction:
      "Contorne a base do pescoço com a cabeça em posição neutra e respiração normal.",
    checkpoint:
      "Não aperte a fita e não suba até a região do queixo.",
  },
  {
    key: "shoulderSlopeDeg",
    label: "Inclinação do ombro",
    unit: "°",
    min: 0,
    max: 25,
    step: 0.1,
    instruction:
      "Meça a queda da linha entre a base do pescoço e o ponto externo do ombro com um inclinômetro ou nível do celular.",
    checkpoint:
      "Registre o ângulo da linha do ombro, não a inclinação do braço.",
  },
] as const satisfies ReadonlyArray<{
  key: keyof BodyMeasurements;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  instruction: string;
  checkpoint: string;
}>;

function optionalNumber(value: string) {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseDraft(
  draft: BodyMeasurementDraft,
): Partial<BodyMeasurements> {
  return {
    heightCm: optionalNumber(draft.heightCm),
    chestCm: optionalNumber(draft.chestCm),
    waistCm: optionalNumber(draft.waistCm),
    hipsCm: optionalNumber(draft.hipsCm),
    shoulderWidthCm: optionalNumber(
      draft.shoulderWidthCm,
    ),
    armLengthCm: optionalNumber(draft.armLengthCm),
    upperArmCm: optionalNumber(draft.upperArmCm),
    thighCm: optionalNumber(draft.thighCm),
    inseamCm: optionalNumber(draft.inseamCm),
    forearmCm: optionalNumber(draft.forearmCm),
    calfCm: optionalNumber(draft.calfCm),
    neckCm: optionalNumber(draft.neckCm),
    shoulderSlopeDeg: optionalNumber(
      draft.shoulderSlopeDeg,
    ),
  };
}

export function GuidedBodyMeasurements({
  measurements,
  errors,
  onChange,
}: GuidedBodyMeasurementsProps) {
  const numericMeasurements = parseDraft(measurements);
  const consistencyIssues =
    checkBodyMeasurementConsistency(
      numericMeasurements,
    );
  const completion = guidedMeasurementCompletion(
    numericMeasurements,
  );

  return (
    <section
      className="rounded-2xl border border-[var(--line)] bg-white"
      aria-labelledby="guided-measurements-title"
    >
      <div className="flex flex-col gap-4 border-b border-[var(--line)] p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
        <div>
          <div className="flex items-center gap-2">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[var(--thread-soft)] text-[var(--thread)]">
              <Ruler size={18} aria-hidden="true" />
            </span>
            <h2
              id="guided-measurements-title"
              className="text-lg font-bold"
            >
              Medição guiada v13
            </h2>
          </div>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--muted)]">
            Quatro medidas que alteram diretamente o
            BodyMesh agora têm instrução de captura e
            conferência cruzada. Os avisos ajudam a
            detectar provável erro de fita ou ângulo, mas
            não bloqueiam corpos com proporções diferentes.
          </p>
        </div>

        <span className="self-start rounded-full bg-[var(--surface-2)] px-3 py-1 text-xs font-semibold tabular-nums text-[var(--muted)]">
          {completion.completed}/{completion.total} preenchidas
        </span>
      </div>

      <ol className="divide-y divide-[var(--line)]">
        {GUIDED_FIELDS.map((guide, index) => {
          const error = errors[guide.key];
          const value = measurements[guide.key];
          const relatedIssues =
            consistencyIssues.filter((issue) =>
              issue.fields.includes(guide.key),
            );
          const needsReview =
            relatedIssues.length > 0;
          const hasValue = value.trim().length > 0;
          const helpId = `${guide.key}-guide`;
          const errorId = `${guide.key}-error`;

          return (
            <li
              key={guide.key}
              className="grid gap-4 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-center"
            >
              <div className="flex gap-4">
                <span
                  className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--ink)] text-xs font-bold text-white"
                  aria-hidden="true"
                >
                  {index + 1}
                </span>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold">
                      {guide.label}
                    </h3>
                    {hasValue && !error ? (
                      <span
                        className={`inline-flex items-center gap-1 text-xs font-semibold ${
                          needsReview
                            ? "text-[var(--warning)]"
                            : "text-emerald-700"
                        }`}
                      >
                        {needsReview ? (
                          <CircleAlert
                            size={14}
                            aria-hidden="true"
                          />
                        ) : (
                          <Check
                            size={14}
                            aria-hidden="true"
                          />
                        )}
                        {needsReview
                          ? "vale conferir"
                          : "preenchida"}
                      </span>
                    ) : null}
                  </div>
                  <p
                    id={helpId}
                    className="mt-1 text-sm leading-6 text-[var(--muted)]"
                  >
                    {guide.instruction}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                    Conferência: {guide.checkpoint}
                  </p>
                </div>
              </div>

              <div>
                <label
                  htmlFor={guide.key}
                  className="text-xs font-semibold text-[var(--muted)]"
                >
                  Valor medido
                </label>
                <div className="relative mt-2">
                  <input
                    id={guide.key}
                    type="number"
                    inputMode="decimal"
                    min={guide.min}
                    max={guide.max}
                    step={guide.step}
                    value={value}
                    aria-invalid={Boolean(error)}
                    aria-describedby={
                      error
                        ? `${helpId} ${errorId}`
                        : helpId
                    }
                    onChange={(event) =>
                      onChange(
                        guide.key,
                        event.target.value,
                      )
                    }
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-[var(--muted)]">
                    {guide.unit}
                  </span>
                </div>
                {error ? (
                  <p
                    id={errorId}
                    className="mt-2 text-sm leading-5 text-[var(--danger)]"
                  >
                    {error}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      {consistencyIssues.length > 0 ? (
        <div className="border-t border-[var(--line)] bg-amber-50/70 p-5 sm:p-6">
          <div className="flex gap-3">
            <CircleAlert
              className="mt-0.5 shrink-0 text-[var(--warning)]"
              size={18}
              aria-hidden="true"
            />
            <div>
              <p className="text-sm font-bold">
                Vale conferir antes de recalibrar
              </p>
              <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                Estes avisos são deliberadamente
                não-bloqueantes: se você repetiu a medida e
                o valor está correto, pode manter o dado.
              </p>
              <ul className="mt-3 space-y-2 text-sm leading-6">
                {consistencyIssues.map((issue) => (
                  <li key={issue.id}>
                    {issue.message}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      ) : completion.completed === completion.total ? (
        <div className="border-t border-[var(--line)] bg-emerald-50/70 p-5 text-sm leading-6 sm:p-6">
          <span className="inline-flex items-center gap-2 font-semibold text-emerald-800">
            <Check size={17} aria-hidden="true" />
            As quatro medidas guiadas estão preenchidas e
            nenhuma conferência relativa foi acionada.
          </span>
        </div>
      ) : null}
    </section>
  );
}
