"use client";

import Image from "next/image";
import Link from "next/link";
import { SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useMirro } from "@/components/mirro-provider";
import { loadMedia } from "@/lib/mirro/db";
import { fitGarment } from "@/lib/mirro/fit";
import type { Garment } from "@/lib/mirro/types";

function useMediaUrl(key?: string) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!key) {
      setUrl(null);
      return;
    }
    let active = true;
    let objectUrl: string | null = null;
    loadMedia(key).then((blob) => {
      if (!blob || !active) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [key]);

  return url;
}

export default function TryOnPage() {
  const { state } = useMirro();
  const profile = state.profile;
  const [selectedId, setSelectedId] = useState(state.garments[0]?.id ?? "");
  const [adjust, setAdjust] = useState({ scale: 1, x: 0, y: 0 });

  const garment: Garment | undefined = useMemo(
    () => state.garments.find((item) => item.id === selectedId) ?? state.garments[0],
    [state.garments, selectedId],
  );

  const bodyUrl = useMediaUrl(profile?.photos.front?.key);
  const garmentUrl = useMediaUrl(garment?.images.front.key);
  const fit = profile && garment ? fitGarment(profile, garment.category, 1) : null;

  if (!profile?.photos.front || state.garments.length === 0) {
    return (
      <div className="rounded-2xl border border-[var(--line)] bg-white p-8">
        <h1 className="font-display text-4xl font-bold tracking-[-.045em]">Experimentar</h1>
        <p className="mt-3 max-w-xl text-[var(--muted)]">Para abrir o provador, você precisa cadastrar o corpo e pelo menos uma peça.</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link className="rounded-xl bg-[var(--ink)] px-4 py-3 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--thread)]" href="/app/body">Cadastrar corpo</Link>
          <Link className="rounded-xl border border-[var(--line)] px-4 py-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--thread)]" href="/app/wardrobe">Cadastrar peça</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-7">
      <div>
        <h1 className="font-display text-4xl font-bold tracking-[-.045em]">Experimentar</h1>
        <p className="mt-2 max-w-3xl text-[var(--muted)]">
          Primeiro motor: remoção de fundo + escala geométrica por medidas. Os ajustes manuais abaixo corrigem a calibração sem alterar sua roupa original.
        </p>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section
          className="relative mx-auto aspect-[3/4] w-full max-w-[650px] overflow-hidden rounded-3xl border border-[var(--line)] bg-[#e9ebf0] shadow-[0_24px_70px_rgba(17,19,24,.10)]"
          aria-label="Prévia do provador"
        >
          {bodyUrl ? (
            <Image
              src={bodyUrl}
              alt="Foto frontal usada como base do provador"
              fill
              unoptimized
              priority
              sizes="(max-width: 1280px) 100vw, 650px"
              className="object-cover"
            />
          ) : null}

          {garmentUrl && fit ? (
            <div
              className="absolute origin-center"
              style={{
                left: `${fit.xPct + adjust.x}%`,
                top: `${fit.yPct + adjust.y}%`,
                width: `${fit.widthPct * adjust.scale}%`,
                height: `${fit.heightPct * adjust.scale}%`,
              }}
            >
              <div className="relative size-full">
                <Image
                  src={garmentUrl}
                  alt={`Simulação de ${garment?.name ?? "peça"}`}
                  fill
                  unoptimized
                  sizes="50vw"
                  className="object-contain"
                />
              </div>
            </div>
          ) : null}

          <div className="absolute bottom-4 left-4 rounded-xl bg-black/75 px-3 py-2 text-xs font-semibold text-white backdrop-blur-md">
            MVP 2D · simulação aproximada
          </div>
        </section>

        <aside className="space-y-4">
          <div className="rounded-2xl border border-[var(--line)] bg-white p-5">
            <label htmlFor="garment" className="text-sm font-semibold">Peça</label>
            <select
              id="garment"
              className="mt-2"
              value={garment?.id ?? ""}
              onChange={(e) => {
                setSelectedId(e.target.value);
                setAdjust({ scale: 1, x: 0, y: 0 });
              }}
            >
              {state.garments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </div>

          <div className="rounded-2xl border border-[var(--line)] bg-white p-5">
            <div className="flex items-center gap-2"><SlidersHorizontal size={18} /><h2 className="font-semibold">Calibração fina</h2></div>
            <div className="mt-5 space-y-5">
              {([
                ["scale", "Escala", 0.7, 1.3, 0.01, adjust.scale],
                ["x", "Horizontal", -12, 12, 0.5, adjust.x],
                ["y", "Vertical", -12, 12, 0.5, adjust.y],
              ] as const).map(([key, label, min, max, step, value]) => (
                <div key={key}>
                  <div className="flex justify-between text-sm">
                    <label htmlFor={key} className="font-semibold">{label}</label>
                    <span className="tabular-nums text-[var(--muted)]">{Number(value).toFixed(key === "scale" ? 2 : 1)}</span>
                  </div>
                  <input
                    id={key}
                    className="mt-2 w-full accent-[var(--thread)]"
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={value}
                    onChange={(e) => setAdjust((prev) => ({ ...prev, [key]: Number(e.target.value) }))}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl bg-[var(--thread-soft)] p-5 text-sm leading-6">
            <strong>O que ainda falta para o realismo final:</strong> reconstrução 3D do corpo, malha da peça e simulação de tecido/colisão. A arquitetura já mantém fotos e parâmetros separados para evoluir nessa direção.
          </div>
        </aside>
      </div>
    </div>
  );
}
