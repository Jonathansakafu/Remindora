'use client';
import { cn, RemindoraMark } from '@remindora/ui';
import { Menu, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { useSession } from '@/lib/session';

export const SITE_NAV = [
  { href: '/', label: 'Home' },
  { href: '/services', label: 'Services' },
  { href: '/about', label: 'About us' },
  { href: '/#download', label: 'Download' },
];

export function SiteHeader() {
  const path = usePathname();
  const signedIn = useSession((s) => s.status === 'signed_in');
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-line/60 bg-bg/70 backdrop-blur-xl">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:rounded-lg focus:bg-cyan focus:px-3 focus:py-2 focus:text-on-accent">
        Skip to content
      </a>
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
        <Link href="/" className="flex items-center gap-2.5" aria-label="Remindora home">
          <RemindoraMark size={32} />
          <span className="font-display text-lg font-semibold tracking-tight">Remindora</span>
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {SITE_NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={path === n.href ? 'page' : undefined}
              className={cn('rounded-lg px-3 py-2 text-sm text-ink-muted transition-colors hover:text-ink', path === n.href && 'text-ink')}
            >
              {n.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          {signedIn ? (
            <Link href="/app/today" className="inline-flex h-10 items-center rounded-xl bg-cyan px-4 text-sm font-semibold text-on-accent hover:bg-[#8af0ff]">
              Open Remindora
            </Link>
          ) : (
            <>
              <Link href="/login" className="inline-flex h-10 items-center rounded-xl px-4 text-sm font-medium text-ink-muted hover:text-ink">
                Sign in
              </Link>
              <Link href="/register" className="inline-flex h-10 items-center rounded-xl bg-cyan px-4 text-sm font-semibold text-on-accent hover:bg-[#8af0ff]">
                Get started free
              </Link>
            </>
          )}
        </div>

        <button type="button" className="grid h-10 w-10 place-items-center rounded-xl text-ink md:hidden" aria-expanded={open} aria-controls="mobile-nav" aria-label={open ? 'Close menu' : 'Open menu'} onClick={() => setOpen((o) => !o)}>
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {open && (
        <nav id="mobile-nav" aria-label="Main" className="border-t border-line/60 px-4 pb-4 md:hidden">
          <ul className="flex flex-col py-2">
            {SITE_NAV.map((n) => (
              <li key={n.href}>
                <Link href={n.href} onClick={() => setOpen(false)} className="block rounded-lg px-2 py-3 text-ink-muted hover:text-ink">
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="grid grid-cols-2 gap-2">
            {signedIn ? (
              <Link href="/app/today" className="col-span-2 inline-flex h-11 items-center justify-center rounded-xl bg-cyan text-sm font-semibold text-on-accent">
                Open Remindora
              </Link>
            ) : (
              <>
                <Link href="/login" className="glass inline-flex h-11 items-center justify-center rounded-xl text-sm font-medium">
                  Sign in
                </Link>
                <Link href="/register" className="inline-flex h-11 items-center justify-center rounded-xl bg-cyan text-sm font-semibold text-on-accent">
                  Get started
                </Link>
              </>
            )}
          </div>
        </nav>
      )}
    </header>
  );
}
