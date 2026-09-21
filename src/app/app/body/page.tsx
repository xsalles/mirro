"use client";

import { Check, ImagePlus, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { useMirro } from "@/components/mirro-provider";
import type { BodySide, MediaRef } from "@/lib/mirro/types";
import { validMeasurement, validateImage } from "@/lib/mirro/validation";

const SIDES: Array<{ key: BodySide; label: string; hint: string }> = [
  { key: "front", label: "Frente", hint: "Corpo inteiro e câmera reta" },
  { key: "right", label: "Lado direito", hint: "Pés na mesma posição" },
  { key: "back", label: "Costas", hint: "Mesma distância da câmera" },
  { key: "left", label: "Lado esquerdo", hint: "Iluminação consistente" },
];

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
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");

  function choose(side: BodySide, file: File | undefined) {
    if (!file) return;
    const error = validateImage(file, 12);
    setErrors((prev) => ({ ...prev, [side]: error ?? "" }));
    if (!error) setFiles((prev) => ({ ...prev, [side]: file }));
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
      if (!files[side.key] && !current?.photos[side.key]) nextErrors[side.key] = "Adicione esta foto para completar a calibração.";
    }
    setErrors(nextErrors);
    if (Object.values(nextErrors).some(Boolean)) return;

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
    await saveProfile({ ...parsed, photos, updatedAt: new Date().toISOString() }, media);
    setStatus("saved");
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-4xl font-bold tracking-[-.045em]">Meu corpo</h1>
          <p className="mt-2 max-w-2xl text-[var(--muted)]">As quatro fotos viram a referência geométrica do provador. Use roupa justa e fundo simples.</p>
        </div>
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--muted)]"><ShieldCheck size={17} /> somente neste dispositivo</span>
      </div>

      <form noValidate onSubmit={submit} className="space-y-8">
        <section>
          <h2 className="text-lg font-bold">Fotos de calibração</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {SIDES.map(({ key, label, hint }) => {
              const selected = files[key];
              const existing = current?.photos[key];
              const error = errors[key];
              return (
                <div key={key}>
                  <label className={`group flex min-h-56 cursor-pointer flex-col justify-between rounded-2xl border border-dashed p-4 transition-colors focus-within:ring-2 focus-within:ring-[var(--thread)] ${error ? "border-[var(--danger)] bg-red-50" : selected || existing ? "border-[#9cabc7] bg-[var(--thread-soft)]/35" : "border-[#c6cad3] bg-white hover:border-[var(--thread)]"}`}>
                    <input
                      className="sr-only"
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      aria-invalid={Boolean(error)}
                      aria-describedby={error ? `${key}-error` : undefined}
                      onChange={(e) => choose(key, e.target.files?.[0])}
                    />
                    <div className="flex items-center justify-between">
                      <span className="grid size-10 place-items-center rounded-xl bg-white"><ImagePlus size={19} aria-hidden="true" /></span>
                      {selected || existing ? <Check size={19} aria-label="Foto adicionada" /> : null}
                    </div>
                    <div>
                      <p className="font-semibold">{label}</p>
                      <p className="mt-1 text-sm leading-5 text-[var(--muted)]">{selected?.name ?? existing?.name ?? hint}</p>
                    </div>
                  </label>
                  {error ? <p id={`${key}-error`} className="mt-2 text-sm text-[var(--danger)]">{error}</p> : null}
                </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-2xl border border-[var(--line)] bg-white p-5 sm:p-6">
          <h2 className="text-lg font-bold">Medidas básicas</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">Essas medidas evitam depender de estimativa visual para escala.</p>
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
                    onChange={(e) => setMeasurements((prev) => ({ ...prev, [key]: e.target.value }))}
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-[var(--muted)]">{unit}</span>
                </div>
                {errors[key] ? <p id={`${key}-error`} className="mt-2 text-sm text-[var(--danger)]">{errors[key]}</p> : null}
              </div>
            ))}
          </div>
        </section>

        <div className="flex items-center gap-4">
          <Button type="submit" disabled={status === "saving"}>{status === "saving" ? "Salvando…" : current ? "Atualizar calibração" : "Salvar meu corpo"}</Button>
          <span role="status" aria-live="polite" className="text-sm text-[var(--muted)]">{status === "saved" ? "Calibração salva neste navegador." : ""}</span>
        </div>
      </form>
    </div>
  );
}
