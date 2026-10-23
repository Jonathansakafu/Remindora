import { creator, RemindoraMark } from '@remindora/ui';
import Link from 'next/link';
import { GithubIcon, LinkedinIcon } from '@/components/brand-icons';

const COLUMNS = [
  {
    title: 'Product',
    links: [
      { href: '/services', label: 'Services' },
      { href: '/#download', label: 'Download' },
      { href: '/register', label: 'Create account' },
      { href: '/login', label: 'Sign in' },
    ],
  },
  {
    title: 'Company',
    links: [
      { href: '/about', label: 'About us' },
      { href: `mailto:${creator.contact.email}`, label: 'Contact' },
      { href: creator.contact.portfolio, label: 'Portfolio' },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-line/60">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <Link href="/" className="flex items-center gap-2.5">
            <RemindoraMark size={30} />
            <span className="font-display text-lg font-semibold">Remindora</span>
          </Link>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-ink-muted">Tasks, calendar, habits and focus — with reminders that know what matters. On the web, desktop and Android.</p>
          <div className="mt-4 flex gap-3 text-ink-muted">
            <a href="https://github.com/Jonathansakafu/Remindora" aria-label="Remindora on GitHub" className="hover:text-ink">
              <GithubIcon size={18} />
            </a>
            <a href={creator.contact.linkedin} aria-label={`${creator.name} on LinkedIn`} className="hover:text-ink">
              <LinkedinIcon size={18} />
            </a>
          </div>
        </div>
        {COLUMNS.map((c) => (
          <div key={c.title}>
            <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-faint">{c.title}</h2>
            <ul className="mt-3 space-y-2">
              {c.links.map((l) => (
                <li key={l.label}>
                  <Link href={l.href} className="text-sm text-ink-muted hover:text-ink">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-line/60">
        <p className="mx-auto max-w-6xl px-4 py-5 text-xs text-ink-faint">© {new Date().getFullYear()} Remindora · Built by {creator.name}</p>
      </div>
    </footer>
  );
}
