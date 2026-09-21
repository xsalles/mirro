"use client";

import { ImagePlus, LoaderCircle, Shirt, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { MediaImage } from "@/components/media-image";
import { useMirro } from "@/components/mirro-provider";
import { removeFlatBackground } from "@/lib/mirro/image-processing";
import type { FabricWeight, Garment, GarmentCategory, MediaRef, StretchLevel } from "@/lib/mirro/types";
import { validateImage } from "@/lib/mirro/validation";

const CATEGORY_LABELS: Record<GarmentCategory, string> = {
  top: "Camiseta",
  shirt: "Camisa",
  hoodie: "Moletom",
  pants: "Calça",
  shorts: "Shorts",
};

export default function WardrobePage() {
  const { state, addGarment, removeGarment } = useMirro();
  const [form, setForm] = useState({
    name: "",
    category: "top" as GarmentCategory,
    size: "M",
    fabricWeight: "medium" as FabricWeight,
    stretch: "low" as StretchLevel,
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
      const garment: Garment = {
        id,
        ...form,
        name: form.name.trim(),
        images: { front: frontRef, back: backRef },
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
        form: "Não foi possível processar a imagem. Tente uma foto com fundo mais uniforme.",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-10">
      <div>
        <h1 className="font-display text-4xl font-bold tracking-[-.045em]">Guarda-roupa</h1>
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
                <select id="category" className="mt-2" value={form.category} onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value as GarmentCategory }))}>
                  {Object.entries(CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </div>

              <div>
                <label htmlFor="size" className="text-sm font-semibold">Tamanho</label>
                <input id="size" className="mt-2" type="text" maxLength={10} value={form.size} onChange={(e) => setForm((prev) => ({ ...prev, size: e.target.value }))} />
              </div>

              <div>
                <label htmlFor="fabricWeight" className="text-sm font-semibold">Peso do tecido</label>
                <select id="fabricWeight" className="mt-2" value={form.fabricWeight} onChange={(e) => setForm((prev) => ({ ...prev, fabricWeight: e.target.value as FabricWeight }))}>
                  <option value="light">Leve</option>
                  <option value="medium">Médio</option>
                  <option value="heavy">Pesado</option>
                </select>
              </div>

              <div>
                <label htmlFor="stretch" className="text-sm font-semibold">Elasticidade</label>
                <select id="stretch" className="mt-2" value={form.stretch} onChange={(e) => setForm((prev) => ({ ...prev, stretch: e.target.value as StretchLevel }))}>
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
