"use client";

import { Check, CircleAlert, ImagePlus, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { BodyMeshPreview } from "@/components/body-mesh-preview";
import { Button } from "@/components/ui/button";
import { useMirro } from "@/components/mirro-provider";
import { calibrateBodyFromPhotos } from "@/lib/mirro/body-image-processing";
import { loadMedia } from "@/lib/mirro/db";
import type { BodySide, MediaRef } from "@/lib/mirro/types";
import { validMeasurement, validateImage } from "@/lib/mirro/validation";

const SIDES: Array<{ key: BodySide; label: string; hint: string }> = [
  { key: "front", label: "Frente", hint: "Corpo inteiro; braços levemente afastados" },
  { key: "right", label: "Lado direito", hint: "Mesma altura e enquadramento da câmera" },
  { key: "back", label: "Costas", hint: "Corpo inteiro e fundo contrastante" },
  { key: "left", label: "Lado esquerdo", hint: "Repita a postura da outra lateral" },
];

type CalibrationStatus = "idle" | "processing" | "saving" | "saved";

export default function BodyPage() {
  const { state, saveProfile } = useMirro();
  const current = state.profile;
  const [measurements, setMeasurements] = useState({
    heightCm: current?.heightCm ? String(current.heightCm) : "",
    chestCm: current?.chestCm ? String(current.chestCm) : "",
    waistCm: current?.waistCm ? String(current.waistCm) : "",
    hipsCm: current?.hipsCm ? String(current.hipsCm) : "",
  });
  const [files, setFiles] = useState<Partial<Record<BodySide, File>>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<CalibrationStatus>("idle");

  function choose(side: BodySide, file: File | undefined) {
    if (!file) return;
    const error = validateImage(file, 12);
    setErrors((prev) => ({ ...prev, [side]: error ?? "", calibration: "" }));
    if (!error) {
      setFiles((prev) => ({ ...prev, [side]: file }));
      setStatus("idle");
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors: Record<string, string> = {};
    const parsed = {
      heightCm: Number(measurements.heightCm),
      chestCm: Number(measurements.chestCm),
      waistCm: Number(measurements.waistCm),
      hipsCm: Number(measurements.hipsCm),
    };

    if (!validMeasurement(parsed.heightCm, 120, 230)) nextErrors.heightCm = "Informe uma altura entre 120 e 230 cm.";
    if (!validMeasurement(parsed.chestCm, 50, 180)) nextErrors.chestCm = "Informe um tórax entre 50 e 180 cm.";
    if (!validMeasurement(parsed.waistCm, 45, 180)) nextErrors.waistCm = "Informe uma cintura entre 45 e 180 cm.";
    if (!validMeasurement(parsed.hipsCm, 50, 190)) nextErrors.hipsCm = "Informe um quadril entre 50 e 190 cm.";

    for (const side of SIDES) {
      if (!files[side.key] && !current?.photos[side.key]) {
        nextErrors[side.key] = "Adicione esta foto para completar a calibração.";
      }
    }

    setErrors(nextErrors);
    if (Object.values(nextErrors).some(Boolean)) return;

    try {
      setStatus("processing");
      const sourcePhotos = {} as Record<BodySide, Blob>;

      for (const { key } of SIDES) {
        const selected = files[key];
        if (selected) {
          sourcePhotos[key] = selected;
          continue;
        }

        const savedRef = current?.photos[key];
        if (!savedRef) throw new Error("Uma das quatro fotos salvas não foi encontrada.");
        const savedBlob = await loadMedia(savedRef.key);
        if (!savedBlob) throw new Error(`A foto de ${key} não está mais disponível neste navegador.`);
        sourcePhotos[key] = savedBlob;
      }

      const calibration = await calibrateBodyFromPhotos(sourcePhotos, parsed);
      setStatus("saving");

      const media: Array<{ blob: Blob; ref: MediaRef }> = [];
      const photos = { ...(current?.photos ?? {}) };

      for (const { key } of SIDES) {
        const file = files[key];
        if (!file) continue;
        const ref: MediaRef = {
          key: `body:${key}:${crypto.randomUUID()}`,
          name: file.name,
          type: file.type,
          size: file.size,
        };
        photos[key] = ref;
        media.push({ blob: file, ref });
      }

      await saveProfile(
        {
          ...parsed,
          photos,
          calibration,
          updatedAt: new Date().toISOString(),
        },
        media,
      );

      setFiles({});
      setStatus("saved");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Não foi possível calibrar as quatro vistas.";
      setErrors((prev) => ({
        ...prev,
        calibration: `${message} Tente fotos com fundo uniforme e contraste maior.`,
      }));
      setStatus("idle");
    }
  }

  const calibration = current?.calibration;
  const hasPendingPhotos = Object.keys(files).length > 0;

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-4xl font-bold tracking-[-.04em]">Meu corpo</h1>
          <p className="mt-2 max-w-2xl text-[var(--muted)]">
            As quatro fotos viram silhuetas calibradas e um hull corporal 3D em centímetros. Use roupa justa, corpo inteiro e fundo simples.
          </p>
        </div>
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--muted)]">
          <ShieldCheck size={17} aria-hidden="true" /> processamento local
        </span>
      </div>

      <form noValidate onSubmit={submit} className="space-y-8">
        <section>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold">Fotos de calibração</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">
                Mantenha a câmera na mesma altura e tente preservar a mesma escala nas quatro vistas.
              </p>
            </div>
            <span className="text-xs font-semibold text-[var(--muted)]">JPG, PNG ou WebP · até 12 MB</span>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {SIDES.map(({ key, label, hint }) => {
              const selected = files[key];
              const existing = current?.photos[key];
              const error = errors[key];

              return (
                <div key={key}>
                  <label
                    className={`group flex min-h-56 cursor-pointer flex-col justify-between rounded-2xl border border-dashed p-4 transition-colors focus-within:ring-2 focus-within:ring-[var(--thread)] ${error ? "border-[var(--danger)] bg-red-50" : selected || existing ? "border-[#9cabc7] bg-[var(--thread-soft)]/35" : "border-[#c6cad3] bg-white hover:border-[var(--thread)]"}`}
                  >
                    <input
                      className="sr-only"
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      aria-invalid={Boolean(error)}
                      aria-describedby={error ? `${key}-error` : undefined}
                      onChange={(e) => choose(key, e.target.files?.[0])}
                    />
                    <div className="flex items-center justify-between">
                      <span className="grid size-10 place-items-center rounded-xl bg-white">
                        <ImagePlus size={19} aria-hidden="true" />
                      </span>
                      {selected || existing ? <Check size={19} aria-label="Foto adicionada" /> : null}
                    </div>
                    <div>
                      <p className="font-semibold">{label}</p>
                      <p className="mt-1 text-sm leading-5 text-[var(--muted)]">
                        {selected?.name ?? existing?.name ?? hint}
                      </p>
                    </div>
                  </label>
                  {error ? (
                    <p id={`${key}-error`} className="mt-2 text-sm text-[var(--danger)]">
                      {error}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-2xl border border-[var(--line)] bg-white p-5 sm:p-6">
          <h2 className="text-lg font-bold">Medidas reais</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Altura define a escala 3D. Tórax, cintura e quadril corrigem as seções transversais detectadas nas silhuetas.
          </p>
          <div className="mt-5 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ["heightCm", "Altura", "cm"],
              ["chestCm", "Tórax", "cm"],
              ["waistCm", "Cintura", "cm"],
              ["hipsCm", "Quadril", "cm"],
            ].map(([key, label, unit]) => (
              <div key={key}>
                <label htmlFor={key} className="text-sm font-semibold">{label}</label>
                <div className="relative mt-2">
                  <input
                    id={key}
                    type="number"
                    inputMode="decimal"
                    min="1"
                    aria-invalid={Boolean(errors[key])}
                    aria-describedby={errors[key] ? `${key}-error` : undefined}
                    value={measurements[key as keyof typeof measurements]}
                    onChange={(e) => {
                      setMeasurements((prev) => ({ ...prev, [key]: e.target.value }));
                      setStatus("idle");
                    }}
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-[var(--muted)]">
                    {unit}
                  </span>
                </div>
                {errors[key] ? (
                  <p id={`${key}-error`} className="mt-2 text-sm text-[var(--danger)]">
                    {errors[key]}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </section>

        {errors.calibration ? (
          <div role="alert" className="flex gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-[var(--danger)]">
            <CircleAlert className="mt-0.5 shrink-0" size={18} aria-hidden="true" />
            <span>{errors.calibration}</span>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-4">
          <Button type="submit" disabled={status === "processing" || status === "saving"}>
            {status === "processing"
              ? "Extraindo 4 silhuetas…"
              : status === "saving"
                ? "Salvando BodyMesh…"
                : current
                  ? "Recalibrar meu corpo"
                  : "Calibrar meu corpo"}
          </Button>
          <span role="status" aria-live="polite" className="text-sm text-[var(--muted)]">
            {status === "processing"
              ? "Processando as fotos localmente."
              : status === "saved"
                ? "Silhuetas e BodyMesh salvos neste navegador."
                : hasPendingPhotos && calibration
                  ? "Há fotos novas aguardando recalibração."
                  : ""}
          </span>
        </div>
      </form>

      {calibration ? (
        <section className="grid gap-5 rounded-2xl bg-[var(--ink)] p-5 text-white sm:p-7 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div>
            <h2 className="font-display text-3xl font-bold tracking-[-.04em]">BodyMesh v1 pronto</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/70">
              Fusão multi-view em perspectiva fraca. Frente/costas estimam largura; laterais estimam profundidade; suas medidas corrigem tórax, cintura e quadril.
            </p>

            <dl className="mt-7 grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-xs font-semibold text-white/55">Qualidade</dt>
                <dd className="mt-1 text-xl font-bold tabular-nums">{Math.round(calibration.quality.score * 100)}%</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-white/55">Vértices</dt>
                <dd className="mt-1 text-xl font-bold tabular-nums">{(calibration.mesh.vertices.length / 3).toLocaleString("pt-BR")}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-white/55">Triângulos</dt>
                <dd className="mt-1 text-xl font-bold tabular-nums">{(calibration.mesh.indices.length / 3).toLocaleString("pt-BR")}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-white/55">Envelope</dt>
                <dd className="mt-1 text-sm font-bold tabular-nums">
                  {calibration.mesh.boundsCm.width.toFixed(0)} × {calibration.mesh.boundsCm.depth.toFixed(0)} × {calibration.mesh.boundsCm.height.toFixed(0)} cm
                </dd>
              </div>
            </dl>

            <div className="mt-7">
              <h3 className="text-sm font-bold">Confiança das vistas</h3>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {SIDES.map(({ key, label }) => (
                  <div key={key} className="flex items-center justify-between border-b border-white/10 py-2 text-sm">
                    <span className="text-white/70">{label}</span>
                    <span className="font-semibold tabular-nums">{Math.round(calibration.silhouettes[key].confidence * 100)}%</span>
                  </div>
                ))}
              </div>
            </div>

            {calibration.quality.warnings.length > 0 ? (
              <div className="mt-6 rounded-xl bg-white/8 p-4">
                <h3 className="text-sm font-bold">Ajustes recomendados</h3>
                <ul className="mt-2 space-y-1 text-sm leading-6 text-white/70">
                  {calibration.quality.warnings.map((warning) => <li key={warning}>• {warning}</li>)}
                </ul>
              </div>
            ) : (
              <p className="mt-6 text-sm font-semibold text-[var(--mint)]">
                As quatro vistas estão coerentes o suficiente para o hull v1.
              </p>
            )}
          </div>

          <BodyMeshPreview calibration={calibration} />
        </section>
      ) : null}
    </div>
  );
}
