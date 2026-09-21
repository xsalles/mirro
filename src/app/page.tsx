import Link from "next/link";
import { ArrowRight, LockKeyhole, ScanLine, Shirt, Sparkles } from "lucide-react";

export default function Home() {
  return (
    <main className="min-h-dvh overflow-hidden bg-[var(--canvas)] text-[var(--ink)]">
      <header className="mx-auto flex h-20 max-w-7xl items-center justify-between px-5 sm:px-8">
        <span className="font-display text-2xl font-bold tracking-[-0.035em]">MIRRO</span>
        <Link href="/app" className="inline-flex min-h-11 items-center rounded-xl border border-[var(--line)] bg-white px-4 text-sm font-semibold transition-colors hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--thread)]">Abrir meu MIRRO</Link>
      </header>

      <section className="mx-auto grid max-w-7xl items-center gap-12 px-5 pb-20 pt-10 sm:px-8 lg:grid-cols-[1.05fr_.95fr] lg:pb-28 lg:pt-20">
        <div>
          <h1 className="font-display max-w-4xl text-[clamp(3.4rem,8vw,7.2rem)] font-bold leading-[.86] tracking-[-.05em]">Seu armário.<br /><span className="text-[var(--thread)]">No seu corpo.</span><br />Antes de vestir.</h1>
          <p className="mt-8 max-w-xl text-lg leading-8 text-[var(--muted)]">Cadastre seu corpo uma vez, fotografe as roupas que você já tem e teste combinações sem trocar de roupa. Sem IA generativa inventando peças.</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href="/app/body" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[var(--ink)] px-5 text-sm font-bold text-white transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--thread)] focus-visible:ring-offset-2">Criar meu espelho <ArrowRight size={18} aria-hidden="true" /></Link>
            <span className="inline-flex min-h-12 items-center gap-2 px-2 text-sm font-semibold text-[var(--muted)]"><LockKeyhole size={17} aria-hidden="true" /> Fotos ficam neste dispositivo</span>
          </div>
        </div>

        <div className="relative mx-auto w-full max-w-[540px]" aria-label="Demonstração do conceito MIRRO">
          <div className="absolute -left-8 top-14 h-[72%] w-px bg-[var(--thread)]" aria-hidden="true" />
          <div className="absolute -left-[38px] top-14 h-2.5 w-5 border-y border-[var(--thread)]" aria-hidden="true" />
          <div className="relative aspect-[4/5] overflow-hidden rounded-[28px] border border-[var(--line)] bg-white shadow-[0_30px_80px_rgba(17,19,24,.12)]">
            <div className="absolute inset-0 bg-[linear-gradient(90deg,transparent_49.8%,#e7e9ef_50%,transparent_50.2%)]" />
            <div className="absolute left-1/2 top-[12%] h-[76%] w-[42%] -translate-x-1/2 rounded-[45%_45%_30%_30%] bg-[#d8dbe3]" aria-hidden="true" />
            <div className="absolute left-1/2 top-[24%] h-[32%] w-[49%] -translate-x-1/2 rounded-[28%_28%_18%_18%] bg-[var(--thread)] shadow-[0_12px_30px_rgba(82,102,255,.24)]" aria-hidden="true" />
            <div className="absolute inset-x-5 bottom-5 flex items-center justify-between rounded-2xl bg-[var(--ink)] p-4 text-white">
              <div><p className="text-xs text-white/60">visual atual</p><p className="mt-0.5 font-semibold">Camiseta azul + jeans</p></div>
              <Sparkles size={20} aria-hidden="true" />
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-[var(--line)] bg-white">
        <div className="mx-auto grid max-w-7xl gap-px bg-[var(--line)] sm:grid-cols-3">
          <article className="bg-white p-7 sm:p-9"><ScanLine size={22} aria-hidden="true" /><h2 className="mt-8 font-display text-2xl font-bold tracking-[-.035em]">4 ângulos do corpo</h2><p className="mt-3 leading-7 text-[var(--muted)]">Frente, lados e costas para construir a base geométrica.</p></article>
          <article className="bg-white p-7 sm:p-9"><Shirt size={22} aria-hidden="true" /><h2 className="mt-8 font-display text-2xl font-bold tracking-[-.035em]">Suas roupas reais</h2><p className="mt-3 leading-7 text-[var(--muted)]">Frente, costas, tecido e elasticidade — sem peça inventada.</p></article>
          <article className="bg-white p-7 sm:p-9"><Sparkles size={22} aria-hidden="true" /><h2 className="mt-8 font-display text-2xl font-bold tracking-[-.035em]">Encaixe determinístico</h2><p className="mt-3 leading-7 text-[var(--muted)]">Processamento de imagem + geometria; o mesmo input produz o mesmo resultado.</p></article>
        </div>
      </section>
    </main>
  );
}
