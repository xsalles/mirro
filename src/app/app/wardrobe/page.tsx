"use client";

import { ImagePlus, LoaderCircle, Shirt, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { MediaImage } from "@/components/media-image";
import { useMirro } from "@/components/mirro-provider";
import { calibrateGarmentFromProcessedImages } from "@/lib/mirro/garment-image-processing";
import {
  FABRIC_LIBRARY,
  fabricProfileToForm,
  getFabricLibraryEntry,
} from "@/lib/mirro/fabric-library";
import { defaultFabricPhysicalProfile } from "@/lib/mirro/garment-mesh";
import { removeFlatBackground } from "@/lib/mirro/image-processing";
import type {
  FabricWeight,
  Garment,
  GarmentCategory,
  MediaRef,
  SleeveLength,
  StretchLevel,
} from "@/lib/mirro/types";
import { validateImage } from "@/lib/mirro/validation";

const CATEGORY_LABELS: Record<GarmentCategory, string> = {
  top: "Camiseta",
  shirt: "Camisa",
  hoodie: "Moletom",
  jacket: "Jaqueta",
  dress: "Vestido",
  skirt: "Saia",
  pants: "Calça",
  shorts: "Shorts",
};

const SLEEVE_LABELS: Record<SleeveLength, string> = {
  sleeveless: "Sem manga",
  short: "Manga curta",
  "three-quarter": "Manga 3/4",
  long: "Manga longa",
};

function supportsSleeves(category: GarmentCategory) {
  return [
    "top",
    "shirt",
    "hoodie",
    "jacket",
    "dress",
  ].includes(category);
}

function defaultSleeve(category: GarmentCategory): SleeveLength {
  if (category === "hoodie" || category === "jacket") {
    return "long";
  }
  if (category === "shirt") {
    return "three-quarter";
  }
  return "short";
}

export default function WardrobePage() {
  const { state, addGarment, removeGarment } = useMirro();
  const [form, setForm] = useState({
    name: "",
    category: "top" as GarmentCategory,
    sleeveLength: "short" as SleeveLength,
    size: "M",
    fabricWeight: "medium" as FabricWeight,
    stretch: "low" as StretchLevel,
    fabricLibraryId: "",
    fabricSource: "engineering-preset" as
      | "engineering-preset"
      | "lab-sheet",
    fabricReference: "",
    fabricTestedAt: "",
  });
  const [physics, setPhysics] = useState(() => {
    const profile = defaultFabricPhysicalProfile("medium", "low");
    return Object.fromEntries(
      Object.entries(profile).map(([key, value]) => [key, String(value)]),
    ) as Record<keyof typeof profile, string>;
  });
  const [front, setFront] = useState<File | null>(null);
  const [back, setBack] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Garment | null>(null);

  function selectImage(side: "front" | "back", file?: File) {
    if (!file) return;
    const error = validateImage(file, 10);
    setErrors((prev) => ({ ...prev, [side]: error ?? "" }));
    if (error) return;
    if (side === "front") setFront(file);
    else setBack(file);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors: Record<string, string> = {};
    if (form.name.trim().length < 2) nextErrors.name = "Dê um nome para identificar a peça.";

    const physicalProfile = {
      densityGsm: Number(physics.densityGsm),
      thicknessMm: Number(physics.thicknessMm),
      stretchWarpPct: Number(physics.stretchWarpPct),
      stretchWeftPct: Number(physics.stretchWeftPct),
      bendStiffness: Number(physics.bendStiffness),
      friction: Number(physics.friction),
    };
    if (physicalProfile.densityGsm < 40 || physicalProfile.densityGsm > 1000) nextErrors.densityGsm = "Use um peso entre 40 e 1000 g/m².";
    if (physicalProfile.thicknessMm < 0.1 || physicalProfile.thicknessMm > 5) nextErrors.thicknessMm = "Use uma espessura entre 0,1 e 5 mm.";
    if (physicalProfile.stretchWarpPct < 0 || physicalProfile.stretchWarpPct > 45) nextErrors.stretchWarpPct = "Use stretch de urdume entre 0 e 45%.";
    if (physicalProfile.stretchWeftPct < 0 || physicalProfile.stretchWeftPct > 45) nextErrors.stretchWeftPct = "Use stretch de trama entre 0 e 45%.";
    if (physicalProfile.bendStiffness < 0 || physicalProfile.bendStiffness > 100) nextErrors.bendStiffness = "Use rigidez entre 0 e 100.";
    if (physicalProfile.friction < 0.02 || physicalProfile.friction > 0.8) nextErrors.friction = "Use atrito entre 0,02 e 0,8.";
    if (
      form.fabricSource === "lab-sheet" &&
      form.fabricReference.trim().length < 3
    ) {
      nextErrors.fabricReference =
        "Informe a referência da ficha técnica ou ensaio que sustenta estes valores.";
    }

    if (!front) nextErrors.front = "Adicione a foto da frente.";
    if (!back) nextErrors.back = "Adicione a foto das costas.";
    setErrors(nextErrors);
    if (Object.values(nextErrors).some(Boolean) || !front || !back) return;

    setSaving(true);
    try {
      const [frontBlob, backBlob] = await Promise.all([
        removeFlatBackground(front),
        removeFlatBackground(back),
      ]);
      const calibration = await calibrateGarmentFromProcessedImages(frontBlob, backBlob);
      const id = crypto.randomUUID();
      const frontRef: MediaRef = {
        key: `garment:${id}:front`,
        name: front.name,
        type: "image/png",
        size: frontBlob.size,
      };
      const backRef: MediaRef = {
        key: `garment:${id}:back`,
        name: back.name,
        type: "image/png",
        size: backBlob.size,
      };
      const selectedFabric = getFabricLibraryEntry(
        form.fabricLibraryId,
      );
      const garment: Garment = {
        id,
        name: form.name.trim(),
        category: form.category,
        sleeveLength: supportsSleeves(form.category)
          ? form.sleeveLength
          : undefined,
        size: form.size,
        fabricWeight: form.fabricWeight,
        stretch: form.stretch,
        images: { front: frontRef, back: backRef },
        calibration,
        physicalProfile,
        fabricLibraryId: form.fabricLibraryId || undefined,
        fabricEvidence:
          form.fabricSource === "lab-sheet"
            ? {
                source: "lab-sheet",
                reference:
                  form.fabricReference.trim(),
                testedAt:
                  form.fabricTestedAt ||
                  undefined,
              }
            : selectedFabric?.evidence ?? {
                source: "engineering-preset",
                reference:
                  selectedFabric?.id,
              },
        createdAt: new Date().toISOString(),
      };
      await addGarment(garment, [
        { blob: frontBlob, ref: frontRef },
        { blob: backBlob, ref: backRef },
      ]);
      setForm((prev) => ({ ...prev, name: "" }));
      setFront(null);
      setBack(null);
    } catch {
      setErrors({
        form: "Não foi possível calibrar a peça. Tente fotos mais esticadas, com fundo uniforme e enquadramento parecido entre frente e costas.",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-10">
      <div>
        <h1 className="font-display text-4xl font-bold tracking-[-.04em]">Guarda-roupa</h1>
        <p className="mt-2 max-w-2xl text-[var(--muted)]">
          Fotografe a peça esticada em uma superfície de cor uniforme. O MIRRO remove o fundo por diferença de cor — sem modelo de IA.
        </p>
      </div>

      <form noValidate onSubmit={submit} className="rounded-2xl border border-[var(--line)] bg-white p-5 sm:p-6">
        <div className="grid gap-6 xl:grid-cols-[1fr_1.2fr]">
          <div>
            <h2 className="text-lg font-bold">Nova peça</h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label htmlFor="name" className="text-sm font-semibold">Nome</label>
                <input
                  id="name"
                  className="mt-2"
                  type="text"
                  value={form.name}
                  aria-invalid={Boolean(errors.name)}
                  aria-describedby={errors.name ? "name-error" : undefined}
                  placeholder="Ex.: camiseta azul oversized"
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                />
                {errors.name ? <p id="name-error" className="mt-2 text-sm text-[var(--danger)]">{errors.name}</p> : null}
              </div>

              <div>
                <label htmlFor="category" className="text-sm font-semibold">Categoria</label>
                <select
                  id="category"
                  className="mt-2"
                  value={form.category}
                  onChange={(e) => {
                    const category =
                      e.target.value as GarmentCategory;
                    setForm((prev) => ({
                      ...prev,
                      category,
                      sleeveLength:
                        supportsSleeves(category)
                          ? defaultSleeve(category)
                          : prev.sleeveLength,
                    }));
                  }}
                >
                  {Object.entries(CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </div>

              <div>
                <label htmlFor="size" className="text-sm font-semibold">Tamanho</label>
                <input id="size" className="mt-2" type="text" maxLength={10} value={form.size} onChange={(e) => setForm((prev) => ({ ...prev, size: e.target.value }))} />
              </div>

              {supportsSleeves(form.category) ? (
                <div className="sm:col-span-2">
                  <label htmlFor="sleeveLength" className="text-sm font-semibold">
                    Comprimento da manga
                  </label>
                  <select
                    id="sleeveLength"
                    className="mt-2"
                    value={form.sleeveLength}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        sleeveLength:
                          e.target.value as SleeveLength,
                      }))
                    }
                  >
                    {Object.entries(SLEEVE_LABELS).map(
                      ([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ),
                    )}
                  </select>
                </div>
              ) : null}

              <div className="sm:col-span-2">
                <label htmlFor="fabricLibraryId" className="text-sm font-semibold">
                  Biblioteca de tecido
                </label>
                <select
                  id="fabricLibraryId"
                  className="mt-2"
                  value={form.fabricLibraryId}
                  onChange={(e) => {
                    const fabricLibraryId = e.target.value;
                    const entry = getFabricLibraryEntry(fabricLibraryId);
                    setForm((prev) => ({
                      ...prev,
                      fabricLibraryId,
                      fabricSource: entry
                        ? entry.source
                        : prev.fabricSource,
                      fabricReference: "",
                      fabricTestedAt: "",
                    }));
                    if (entry) setPhysics(fabricProfileToForm(entry.profile));
                  }}
                >
                  <option value="">Preset simples / ajuste manual</option>
                  {FABRIC_LIBRARY.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name} · {entry.profile.densityGsm} g/m²
                    </option>
                  ))}
                </select>
                {form.fabricLibraryId ? (
                  <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
                    {getFabricLibraryEntry(form.fabricLibraryId)?.notes}
                  </p>
                ) : null}
              </div>

              <div>
                <label htmlFor="fabricWeight" className="text-sm font-semibold">Peso do tecido</label>
                <select
                  id="fabricWeight"
                  className="mt-2"
                  value={form.fabricWeight}
                  onChange={(e) => {
                    const fabricWeight = e.target.value as FabricWeight;
                    setForm((prev) => ({
                      ...prev,
                      fabricWeight,
                      fabricLibraryId: "",
                    }));
                    const preset = defaultFabricPhysicalProfile(fabricWeight, form.stretch);
                    setPhysics(fabricProfileToForm(preset));
                  }}
                >
                  <option value="light">Leve</option>
                  <option value="medium">Médio</option>
                  <option value="heavy">Pesado</option>
                </select>
              </div>

              <div>
                <label htmlFor="stretch" className="text-sm font-semibold">Elasticidade</label>
                <select
                  id="stretch"
                  className="mt-2"
                  value={form.stretch}
                  onChange={(e) => {
                    const stretch = e.target.value as StretchLevel;
                    setForm((prev) => ({
                      ...prev,
                      stretch,
                      fabricLibraryId: "",
                    }));
                    const preset = defaultFabricPhysicalProfile(form.fabricWeight, stretch);
                    setPhysics(fabricProfileToForm(preset));
                  }}
                >
                  <option value="none">Nenhuma</option>
                  <option value="low">Pouca</option>
                  <option value="medium">Média</option>
                  <option value="high">Alta</option>
                </select>
              </div>
            </div>
          </div>

          <div>
            <h2 className="text-lg font-bold">Fotos da peça</h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {([
                ["front", "Frente", front],
                ["back", "Costas", back],
              ] as const).map(([key, label, file]) => (
                <div key={key}>
                  <label className={`flex min-h-52 cursor-pointer flex-col justify-between rounded-2xl border border-dashed p-4 transition-colors focus-within:ring-2 focus-within:ring-[var(--thread)] ${errors[key] ? "border-[var(--danger)] bg-red-50" : file ? "border-[#9cabc7] bg-[var(--thread-soft)]/35" : "border-[#c6cad3] hover:border-[var(--thread)]"}`}>
                    <input
                      className="sr-only"
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      aria-invalid={Boolean(errors[key])}
                      onChange={(e) => selectImage(key, e.target.files?.[0])}
                    />
                    <ImagePlus size={20} aria-hidden="true" />
                    <div>
                      <p className="font-semibold">{label}</p>
                      <p className="mt-1 break-all text-sm text-[var(--muted)]">{file?.name ?? "JPG, PNG ou WebP · até 10 MB"}</p>
                    </div>
                  </label>
                  {errors[key] ? <p className="mt-2 text-sm text-[var(--danger)]">{errors[key]}</p> : null}
                </div>
              ))}
            </div>
          </div>
        </div>

        <section className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--surface-muted)]/45 p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-bold">Física do tecido</h3>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--muted)]">
                Os presets acima preenchem estes valores. Se você souber a composição ou ficha técnica da peça, ajuste aqui para o XPBD usar massa, espessura, elasticidade por eixo, dobra e atrito mais próximos do tecido real.
              </p>
            </div>
            <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-[var(--muted)]">XPBD anisotrópico</span>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <div>
              <label htmlFor="fabricSource" className="text-xs font-semibold">
                Origem dos parâmetros
              </label>
              <select
                id="fabricSource"
                className="mt-2"
                value={form.fabricSource}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    fabricSource: e.target.value as
                      | "engineering-preset"
                      | "lab-sheet",
                    fabricLibraryId:
                      e.target.value === "lab-sheet"
                        ? ""
                        : prev.fabricLibraryId,
                  }))
                }
              >
                <option value="engineering-preset">
                  Estimativa / preset de engenharia
                </option>
                <option value="lab-sheet">
                  Ficha técnica ou ensaio medido
                </option>
              </select>
            </div>

            {form.fabricSource === "lab-sheet" ? (
              <>
                <div>
                  <label htmlFor="fabricReference" className="text-xs font-semibold">
                    Referência da ficha/ensaio
                  </label>
                  <input
                    id="fabricReference"
                    className="mt-2"
                    type="text"
                    value={form.fabricReference}
                    aria-invalid={Boolean(errors.fabricReference)}
                    aria-describedby={
                      errors.fabricReference
                        ? "fabricReference-error"
                        : undefined
                    }
                    placeholder="Ex.: relatório LAB-2026-041"
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        fabricReference: e.target.value,
                      }))
                    }
                  />
                  {errors.fabricReference ? (
                    <p
                      id="fabricReference-error"
                      className="mt-1.5 text-xs leading-5 text-[var(--danger)]"
                    >
                      {errors.fabricReference}
                    </p>
                  ) : null}
                </div>
                <div>
                  <label htmlFor="fabricTestedAt" className="text-xs font-semibold">
                    Data do ensaio
                  </label>
                  <input
                    id="fabricTestedAt"
                    className="mt-2"
                    type="date"
                    value={form.fabricTestedAt}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        fabricTestedAt: e.target.value,
                      }))
                    }
                  />
                </div>
              </>
            ) : (
              <p className="self-end text-xs leading-5 text-[var(--muted)] sm:col-span-1 xl:col-span-2">
                Presets continuam disponíveis, mas a MIRRO os identifica como estimativas. Valores de ficha técnica só recebem status medido quando você informa a referência.
              </p>
            )}
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
            {[
              ["densityGsm", "Gramatura", "g/m²", "40", "1000", "1"],
              ["thicknessMm", "Espessura", "mm", "0.1", "5", "0.05"],
              ["stretchWarpPct", "Stretch urdume", "%", "0", "45", "1"],
              ["stretchWeftPct", "Stretch trama", "%", "0", "45", "1"],
              ["bendStiffness", "Rigidez dobra", "/100", "0", "100", "1"],
              ["friction", "Atrito", "", "0.02", "0.8", "0.01"],
            ].map(([key, label, unit, min, max, step]) => (
              <div key={key}>
                <label htmlFor={key} className="text-xs font-semibold">{label}</label>
                <div className="relative mt-2">
                  <input
                    id={key}
                    type="number"
                    inputMode="decimal"
                    min={min}
                    max={max}
                    step={step}
                    value={physics[key as keyof typeof physics]}
                    aria-invalid={Boolean(errors[key])}
                    aria-describedby={errors[key] ? `${key}-error` : undefined}
                    onChange={(e) => {
                      setPhysics((prev) => ({ ...prev, [key]: e.target.value }));
                      setForm((prev) => ({ ...prev, fabricLibraryId: "" }));
                    }}
                  />
                  {unit ? (
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-[var(--muted)]">
                      {unit}
                    </span>
                  ) : null}
                </div>
                {errors[key] ? <p id={`${key}-error`} className="mt-1.5 text-xs leading-5 text-[var(--danger)]">{errors[key]}</p> : null}
              </div>
            ))}
          </div>
        </section>

        {errors.form ? <p role="alert" className="mt-5 rounded-xl bg-red-50 p-3 text-sm text-[var(--danger)]">{errors.form}</p> : null}
        <div className="mt-6">
          <Button type="submit" disabled={saving}>
            {saving ? <><LoaderCircle size={17} className="animate-spin motion-reduce:animate-none" /> Processando…</> : "Adicionar ao guarda-roupa"}
          </Button>
        </div>
      </form>

      <section>
        <div>
          <h2 className="font-display text-3xl font-bold tracking-[-.04em]">Minhas peças</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">{state.garments.length} cadastrada(s)</p>
        </div>

        {state.garments.length === 0 ? (
          <div className="mt-5 flex min-h-52 flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--line)] bg-white p-6 text-center">
            <Shirt size={24} aria-hidden="true" />
            <p className="mt-4 font-semibold">Seu guarda-roupa ainda está vazio.</p>
            <p className="mt-1 text-sm text-[var(--muted)]">Cadastre a primeira peça acima.</p>
          </div>
        ) : (
          <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {state.garments.map((garment) => (
              <article key={garment.id} className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
                <div className="relative aspect-[4/3] bg-[var(--surface-2)]">
                  <MediaImage media={garment.images.front} alt={`Frente de ${garment.name}`} contain />
                </div>
                <div className="flex items-start justify-between gap-4 p-4">
                  <div>
                    <h3 className="font-semibold">{garment.name}</h3>
                    <p className="mt-1 text-sm text-[var(--muted)]">{CATEGORY_LABELS[garment.category]} · {garment.size}</p>
                    {garment.calibration ? (
                      <p className="mt-2 text-xs font-semibold text-[var(--muted)]">
                        forma calibrada · {Math.round(garment.calibration.quality.score * 100)}%
                      </p>
                    ) : null}
                    {garment.fabricLibraryId ? (
                      <p className="mt-1 text-xs font-semibold text-[var(--thread)]">
                        {getFabricLibraryEntry(garment.fabricLibraryId)?.name ?? "Tecido da biblioteca"}
                      </p>
                    ) : null}
                    {garment.fabricEvidence?.source === "lab-sheet" ? (
                      <p className="mt-1 text-xs font-semibold text-[var(--thread)]">
                        parâmetros medidos · {garment.fabricEvidence.reference ?? "ficha técnica"}
                      </p>
                    ) : garment.physicalProfile ? (
                      <p className="mt-1 text-xs font-semibold text-[var(--muted)]">
                        parâmetros estimados / ajustados
                      </p>
                    ) : null}
                    {garment.physicalProfile ? (
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        {garment.physicalProfile.densityGsm} g/m² · {garment.physicalProfile.thicknessMm} mm · {garment.physicalProfile.stretchWarpPct}/{garment.physicalProfile.stretchWeftPct}% stretch
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => setPendingDelete(garment)}
                    className="grid size-10 cursor-pointer place-items-center rounded-xl text-[var(--muted)] hover:bg-red-50 hover:text-[var(--danger)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--thread)]"
                    aria-label={`Remover ${garment.name}`}
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Remover esta peça?"
        description={pendingDelete ? `“${pendingDelete.name}” e as duas imagens salvas neste navegador serão apagadas. Esta ação não pode ser desfeita.` : ""}
        confirmLabel="Remover peça"
        onClose={() => setPendingDelete(null)}
        onConfirm={async () => {
          if (!pendingDelete) return;
          await removeGarment(pendingDelete);
          setPendingDelete(null);
        }}
      />
    </div>
  );
}
