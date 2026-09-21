"use client";

import Link from "next/link";
import { ArrowRight, ScanLine, Shirt, Sparkles } from "lucide-react";
import { useMirro } from "@/components/mirro-provider";

export default function DashboardPage() {
  const { state, ready } = useMirro();
  const bodyReady = Boolean(state.profile?.calibration);
  const garmentCount = state.garments.length;

  return (
    <div className="space-y-8">
      <div><h1 className="font-display text-4xl font-bold tracking-[-.04em] sm:text-5xl">Seu espelho começa aqui.</h1><p className="mt-3 max-w-2xl text-[var(--muted)]">Monte a base corporal, digitalize suas peças e depois combine tudo no provador.</p></div>
      <section className="grid gap-4 md:grid-cols-3" aria-label="Progresso de configuração">
        {[
          { href: "/app/body", icon: ScanLine, title: "Meu corpo", value: bodyReady ? "BodyMesh pronto" : "Pendente", copy: "4 vistas + medidas + hull 3D", done: bodyReady },
          { href: "/app/wardrobe", icon: Shirt, title: "Guarda-roupa", value: `${garmentCount} ${garmentCount === 1 ? "peça" : "peças"}`, copy: "Frente e costas", done: garmentCount > 0 },
          { href: "/app/try-on", icon: Sparkles, title: "Experimentar", value: bodyReady && garmentCount ? "Liberado" : "Aguardando", copy: "BodyMesh + pelo menos 1 peça", done: bodyReady && garmentCount > 0 },
        ].map(({ href, icon: Icon, title, value, copy, done }) => (
          <Link key={href} href={href} className="group rounded-2xl border border-[var(--line)] bg-white p-5 transition-[transform,border-color] hover:-translate-y-0.5 hover:border-[#b7bdc9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--thread)]">
            <div className="flex items-center justify-between"><span className={`grid size-10 place-items-center rounded-xl ${done ? "bg-[var(--mint)]" : "bg-[var(--surface-2)]"}`}><Icon size={19} aria-hidden="true" /></span><ArrowRight size={18} className="text-[var(--muted)] transition-transform group-hover:translate-x-0.5" aria-hidden="true" /></div>
            <h2 className="mt-8 text-sm font-semibold text-[var(--muted)]">{title}</h2><p className="mt-1 font-display text-2xl font-bold tracking-[-.035em]">{ready ? value : "Carregando…"}</p><p className="mt-1 text-sm text-[var(--muted)]">{copy}</p>
          </Link>
        ))}
      </section>
      <aside className="rounded-2xl bg-[var(--ink)] p-6 text-white sm:p-8"><p className="max-w-2xl text-sm leading-6 text-white/70">Fotos, silhuetas derivadas, BodyMesh e peças ficam somente no IndexedDB deste navegador. Nada é enviado para uma API ou nuvem.</p></aside>
    </div>
  );
}
