'use client';
import { cn } from '@remindora/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/app/settings', label: 'Profile & appearance' },
  { href: '/app/settings/notifications', label: 'Notifications' },
  { href: '/app/settings/devices', label: 'Linked devices' },
  { href: '/app/settings/integrations', label: 'Integrations' },
  { href: '/app/settings/workspace', label: 'Workspaces' },
  { href: '/app/settings/templates', label: 'Templates' },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname().replace(/\/$/, '');
  return (
    <div className="mx-auto max-w-5xl px-4 pb-10 pt-6 md:px-8">
      <h1 className="font-display text-[28px] font-semibold tracking-tight">Settings</h1>
      <nav aria-label="Settings" className="scroll-thin -mx-1 mt-4 flex gap-1 overflow-x-auto px-1 pb-2">
        {TABS.map((t) => {
          const active = pathname === t.href || (t.href === '/app/settings/devices' && pathname === '/app/settings/link-device');
          return (
            <Link key={t.href} href={t.href} aria-current={active ? 'page' : undefined} className={cn('whitespace-nowrap rounded-xl px-3 py-1.5 text-sm text-ink-muted hover:bg-white/5 hover:text-ink', active && 'bg-surface-high text-ink shadow-[0_0_0_1px_rgb(96_233_255/0.25)]')}>
              {t.label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-4">{children}</div>
    </div>
  );
}
