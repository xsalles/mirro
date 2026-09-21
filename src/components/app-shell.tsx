"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Grid2X2, ScanLine, Shirt, Sparkles } from "lucide-react";
import type { ReactNode } from "react";

const NAV = [
  { href: "/app", label: "Início", icon: Grid2X2 },
  { href: "/app/body", label: "Meu corpo", icon: ScanLine },
  { href: "/app/wardrobe", label: "Guarda-roupa", icon: Shirt },
  { href: "/app/try-on", label: "Experimentar", icon: Sparkles },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="min-h-dvh bg-[var(--canvas)] text-[var(--ink)]">
      <header className="sticky top-0 z-30 border-b border-[var(--line)] bg-[color:rgba(247,248,250,.92)] backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/" className="font-display text-2xl font-bold tracking-[-0.035em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--thread)]">MIRRO</Link>
          <span className="rounded-full border border-[var(--line)] bg-white px-3 py-1 text-xs font-semibold text-[var(--muted)]">local-first · sem IA</span>
        </div>
      </header>
      <div className="mx-auto grid max-w-7xl gap-6 px-4 pb-28 pt-6 sm:px-6 lg:grid-cols-[220px_1fr] lg:px-8 lg:pb-10">
        <nav aria-label="Navegação principal" className="hidden lg:block">
          <div className="sticky top-24 space-y-1">
            {NAV.map(({ href, label, icon: Icon }) => {
              const active = href === "/app" ? pathname === href : pathname.startsWith(href);
              return (
                <Link key={href} href={href} aria-current={active ? "page" : undefined} className={`flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--thread)] ${active ? "bg-[var(--ink)] text-white" : "text-[var(--muted)] hover:bg-white hover:text-[var(--ink)]"}`}>
                  <Icon size={18} aria-hidden="true" /> {label}
                </Link>
              );
            })}
          </div>
        </nav>
        <main className="min-w-0">{children}</main>
      </div>
      <nav aria-label="Navegação principal" className="fixed inset-x-3 bottom-3 z-40 grid grid-cols-4 rounded-2xl border border-[var(--line)] bg-white/95 p-1 shadow-[0_10px_35px_rgba(17,19,24,.12)] backdrop-blur-xl lg:hidden">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === "/app" ? pathname === href : pathname.startsWith(href);
          return (
            <Link key={href} href={href} aria-current={active ? "page" : undefined} className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[11px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--thread)] ${active ? "bg-[var(--ink)] text-white" : "text-[var(--muted)]"}`}>
              <Icon size={18} aria-hidden="true" /> {label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
