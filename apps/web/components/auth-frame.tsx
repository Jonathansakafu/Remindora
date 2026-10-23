import { GlassPanel, RemindoraMark } from '@remindora/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';

export function AuthFrame({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <main id="main" className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-4 py-10">
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-[-20%] h-[640px] w-[640px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgb(81_228_255/0.16),transparent_62%)]" />
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-[8%] h-[420px] w-[720px] -translate-x-1/2 -rotate-12 rounded-[50%] border border-cyan/10" />
      <GlassPanel strong glow className="relative w-full max-w-md p-7 sm:p-8">
        <Link href="/" className="mb-6 flex w-fit items-center gap-3" aria-label="Remindora home">
          <RemindoraMark size={40} />
          <span className="font-display text-xl font-semibold tracking-tight">Remindora</span>
        </Link>
        <h1 className="font-display text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1.5 text-sm text-ink-muted">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </GlassPanel>
      <nav aria-label="Site" className="relative mt-6 flex gap-5 text-xs text-ink-faint">
        <Link href="/" className="hover:text-ink">Home</Link>
        <Link href="/services" className="hover:text-ink">Services</Link>
        <Link href="/about" className="hover:text-ink">About us</Link>
      </nav>
    </main>
  );
}
