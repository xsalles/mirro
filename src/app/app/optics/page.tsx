"use client";

import {
  Aperture,
  Check,
  CircleAlert,
  ImagePlus,
  Ruler,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useState, type ChangeEvent } from "react";
import { useMirro } from "@/components/mirro-provider";
import { Button } from "@/components/ui/button";
import { calibrateOpticsFromPhotos } from "@/lib/mirro/optical-calibration";
import { validateImage } from "@/lib/mirro/validation";

type Status = "idle" | "processing" | "saved";

export default function OpticsPage() {
  const { state, saveOptics } = useMirro();
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");

  function choose(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []);
    if (!selected.length) return;

    const next = [...files];
    for (const file of selected) {
      const validation = validateImage(file, 12);
      if (validation) {
        setError(`${file.name}: ${validation}`);
        event.target.value = "";
        return;
      }
      if (
        !next.some(
          (item) =>
            item.name === file.name &&
            item.size === file.size,
        )
      ) {
        next.push(file);
      }
    }

    setFiles(next.slice(0, 12));
    setError("");
    setStatus("idle");
    event.target.value = "";
  }

  async function calibrate() {
    if (files.length < 6) {
      setError(
        "Adicione pelo menos 6 fotos do cartão MIRRO em ângulos diferentes.",
      );
      return;
    }

    try {
      setStatus("processing");
      setError("");
      const profile = await calibrateOpticsFromPhotos(files);
      await saveOptics(profile);
      setStatus("saved");
    } catch (cause) {
      setStatus("idle");
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível calibrar a lente.",
      );
    }
  }

  const optics = state.optics;

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-4xl font-bold tracking-[-.04em]">
            Calibração óptica
          </h1>
          <p className="mt-2 max-w-3xl text-[var(--muted)]">
            Calibre a câmera uma vez e reutilize a lente no corpo.
            O MIRRO resolve intrínsecos + Brown–Conrady com 6–12
            fotos do cartão em posições e inclinações diferentes.
          </p>
        </div>
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--muted)]">
          <ShieldCheck size={17} aria-hidden="true" />
          fotos não são armazenadas
        </span>
      </div>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="rounded-2xl border border-[var(--line)] bg-white p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold">
                1. Fotografe o alvo
              </h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--muted)]">
                Use sempre a mesma lente, orientação, resolução e
                nível de zoom. Mova o cartão pelo enquadramento e
                incline-o em horizontal e vertical. Inclua centro,
                cantos e bordas; evite fotos quase idênticas.
              </p>
            </div>
            <Link
              href="/calibration-card"
              className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[var(--line)] px-3 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--thread)]"
            >
              <Ruler size={15} aria-hidden="true" />
              Imprimir cartão
            </Link>
          </div>

          <label className="mt-5 flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-[#c6cad3] bg-[var(--surface-2)] p-6 text-center transition-colors hover:border-[var(--thread)] focus-within:ring-2 focus-within:ring-[var(--thread)]">
            <input
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              onChange={choose}
            />
            <span className="grid size-11 place-items-center rounded-xl bg-white">
              <ImagePlus size={20} aria-hidden="true" />
            </span>
            <span className="mt-3 font-semibold">
              Adicionar 6–12 fotos
            </span>
            <span className="mt-1 text-sm text-[var(--muted)]">
              {files.length}/12 selecionadas · JPG, PNG ou WebP
            </span>
          </label>

          {files.length > 0 ? (
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {files.map((file, index) => (
                <div
                  key={`${file.name}:${file.size}`}
                  className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-[var(--line)] px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">
                      {index + 1}. {file.name}
                    </p>
                    <p className="text-xs text-[var(--muted)]">
                      {(file.size / 1024 / 1024).toFixed(1)} MB
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label={`Remover ${file.name}`}
                    onClick={() => {
                      setFiles((current) =>
                        current.filter((_, at) => at !== index),
                      );
                      setStatus("idle");
                    }}
                    className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-lg hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--thread)]"
                  >
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          {error ? (
            <div
              role="alert"
              className="mt-4 flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-[var(--danger)]"
            >
              <CircleAlert
                className="mt-0.5 shrink-0"
                size={18}
                aria-hidden="true"
              />
              <span>{error}</span>
            </div>
          ) : null}

          <div className="mt-5 flex flex-wrap items-center gap-4">
            <Button
              type="button"
              onClick={calibrate}
              disabled={status === "processing"}
            >
              {status === "processing"
                ? "Resolvendo câmera…"
                : optics
                  ? "Recalibrar lente"
                  : "Calibrar lente"}
            </Button>
            <span
              role="status"
              aria-live="polite"
              className="text-sm text-[var(--muted)]"
            >
              {status === "processing"
                ? "Homografias, K, poses e distorção sendo resolvidos localmente."
                : status === "saved"
                  ? "Perfil óptico salvo neste navegador."
                  : "As fotos servem apenas para o cálculo atual."}
            </span>
          </div>
        </div>

        <aside className="rounded-2xl bg-[var(--ink)] p-5 text-white sm:p-6">
          <Aperture size={25} aria-hidden="true" />
          <h2 className="mt-5 font-display text-2xl font-bold tracking-[-.035em]">
            Captura boa
          </h2>
          <div className="mt-4 space-y-3 text-sm leading-6 text-white/70">
            <p>• celular parado ou na mão — o cartão pode mover</p>
            <p>• mesma câmera/lente e mesmo zoom em todas</p>
            <p>• alvo inteiro, sem reflexo e sem blur</p>
            <p>• inclinações positivas e negativas em X/Y</p>
            <p>• alvo no centro, bordas e quatro cantos</p>
          </div>
        </aside>
      </section>

      {optics ? (
        <section className="rounded-2xl border border-[var(--line)] bg-white p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold">
                Perfil óptico ativo
              </h2>
              <p className="mt-1 text-sm text-[var(--muted)]">
                {optics.frameCount} frames ·{" "}
                {optics.imageWidth}×{optics.imageHeight}
              </p>
            </div>
            <span className="inline-flex items-center gap-2 rounded-full bg-[var(--mint)] px-3 py-1.5 text-xs font-bold">
              <Check size={14} aria-hidden="true" />
              reutilizável
            </span>
          </div>

          <dl className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-xs font-semibold text-[var(--muted)]">
                Focal
              </dt>
              <dd className="mt-1 text-lg font-bold tabular-nums">
                {Math.round(
                  (optics.intrinsics.fx + optics.intrinsics.fy) /
                    2,
                )}{" "}
                px
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-[var(--muted)]">
                RMS reprojeção
              </dt>
              <dd className="mt-1 text-lg font-bold tabular-nums">
                {optics.rmsReprojectionErrorPx.toFixed(2)} px
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-[var(--muted)]">
                Condicionamento
              </dt>
              <dd className="mt-1 text-lg font-bold tabular-nums">
                {Math.round(optics.conditionScore * 100)}%
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-[var(--muted)]">
                Principal point
              </dt>
              <dd className="mt-1 text-sm font-bold tabular-nums">
                {optics.intrinsics.cx.toFixed(1)} ·{" "}
                {optics.intrinsics.cy.toFixed(1)}
              </dd>
            </div>
          </dl>

          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {(
              [
                ["k1", optics.distortion.k1],
                ["k2", optics.distortion.k2],
                ["k3", optics.distortion.k3],
                ["p1", optics.distortion.p1],
                ["p2", optics.distortion.p2],
              ] as const
            ).map(([label, value]) => (
              <div
                key={label}
                className="rounded-xl bg-[var(--surface-2)] p-3"
              >
                <p className="text-xs font-semibold text-[var(--muted)]">
                  {label}
                </p>
                <p className="mt-1 font-mono text-sm font-bold tabular-nums">
                  {value.toFixed(6)}
                </p>
              </div>
            ))}
          </div>

          {optics.warnings.length ? (
            <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6">
              {optics.warnings.map((warning) => (
                <p key={warning}>• {warning}</p>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
