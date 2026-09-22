"use client";

import Link from "next/link";

const MARKERS = [
  { name: "magenta", color: "#D6008F", left: "26mm", top: "26mm" },
  { name: "cyan", color: "#00A6D6", left: "184mm", top: "26mm" },
  { name: "yellow", color: "#F6C800", left: "26mm", top: "271mm" },
  { name: "blue", color: "#4054FF", left: "184mm", top: "271mm" },
] as const;

export default function CalibrationCardPage() {
  return (
    <main className="min-h-screen bg-[var(--canvas)] px-4 py-8 text-[var(--ink)] print:bg-white print:p-0">
      <div className="mx-auto mb-6 flex max-w-4xl flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-[-.04em]">
            Cartão métrico MIRRO
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--muted)]">
            Imprima em A4, escala 100%, sem “ajustar à página”. Nas quatro fotos do corpo, deixe o cartão inteiro visível e no mesmo plano do corpo.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/app/body"
            className="rounded-xl border border-[var(--line)] bg-white px-4 py-2.5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--thread)]"
          >
            Voltar
          </Link>
          <button
            type="button"
            onClick={() => window.print()}
            className="cursor-pointer rounded-xl bg-[var(--ink)] px-4 py-2.5 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--thread)]"
          >
            Imprimir A4
          </button>
        </div>
      </div>

      <section
        aria-label="Alvo A4 de calibração métrica"
        className="relative mx-auto overflow-hidden border border-black/15 bg-white shadow-xl print:border-0 print:shadow-none"
        style={{ width: "210mm", height: "297mm" }}
      >
        <div className="absolute left-1/2 top-[11mm] -translate-x-1/2 text-center">
          <p className="text-[12pt] font-bold tracking-[0.16em] text-black">MIRRO</p>
          <p className="mt-[1mm] text-[7pt] font-semibold text-black/60">
            METRIC TARGET · A4 · PRINT 100%
          </p>
        </div>

        {MARKERS.map((marker) => (
          <div
            key={marker.name}
            aria-label={"Marcador " + marker.name}
            className="absolute"
            style={{
              left: marker.left,
              top: marker.top,
              width: "18mm",
              height: "18mm",
              backgroundColor: marker.color,
              transform: "translate(-50%, -50%)",
            }}
          />
        ))}

        <div className="absolute left-1/2 top-1/2 w-[132mm] -translate-x-1/2 -translate-y-1/2 text-center text-black">
          <div className="border-y border-black/15 py-[7mm]">
            <p className="text-[11pt] font-bold">Mantenha este cartão no mesmo plano do corpo</p>
            <p className="mx-auto mt-[3mm] max-w-[112mm] text-[8pt] leading-[1.55] text-black/65">
              Não dobre. Não cubra os quatro quadrados. Evite reflexos. Use a mesma distância e altura de câmera nas vistas frente, direita, costas e esquerda.
            </p>
          </div>
        </div>

        <div className="absolute bottom-[8mm] left-1/2 -translate-x-1/2 whitespace-nowrap text-[6.5pt] font-semibold text-black/45">
          Centros horizontais: 158 mm · centros verticais: 245 mm · folha: 210 × 297 mm
        </div>
      </section>
    </main>
  );
}
