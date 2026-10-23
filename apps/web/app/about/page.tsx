import { aboutApp, creator, GlassPanel, RemindoraMark } from '@remindora/ui';
import { Code2, HeartHandshake, Target, ExternalLink, Globe, Mail, MessageCircle, Rocket, ShieldCheck } from 'lucide-react';
import { GithubIcon, LinkedinIcon } from '@/components/brand-icons';
import type { Metadata } from 'next';
import { SiteShell } from '@/components/marketing/site-shell';

export const metadata: Metadata = { title: 'About us', description: `${aboutApp.name} is built by ${creator.name}, ${creator.role}.` };

const HIGHLIGHT_ICONS = [Code2, Rocket, ShieldCheck];

export default function AboutPage() {
  const c = creator.contact;
  const channels = [
    { icon: Mail, label: 'Email', value: c.email, href: `mailto:${c.email}` },
    { icon: MessageCircle, label: 'WhatsApp', value: c.whatsapp, href: `https://wa.me/${c.whatsapp.replace(/[^\d]/g, '')}` },
    { icon: LinkedinIcon, label: 'LinkedIn', value: 'jonathan-sakafu', href: c.linkedin },
    { icon: GithubIcon, label: 'GitHub', value: 'jonathansakafu', href: c.github },
    { icon: Globe, label: 'Portfolio', value: 'View portfolio', href: c.portfolio },
  ];
  return (
    <SiteShell>
    <div className="relative overflow-hidden px-4 py-10 md:py-16">
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-[-15%] h-[620px] w-[620px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgb(165_140_255/0.14),transparent_62%)]" />
      <div className="relative mx-auto max-w-4xl">
        <section aria-labelledby="about-app" className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
          <RemindoraMark size={72} />
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan">About us</p>
            <h1 id="about-app" className="font-display text-3xl font-semibold tracking-tight md:text-4xl">{aboutApp.name}</h1>
            <p className="mt-2 max-w-2xl text-ink-muted">{aboutApp.summary}</p>
          </div>
        </section>

        <section aria-label="Mission and values" className="mt-10 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-line bg-bg-elevated/50 p-6">
            <Target size={20} className="text-cyan" />
            <h2 className="mt-3 font-display text-lg font-semibold">Our mission</h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-muted">Help people remember what matters and act on it at the right moment — without drowning them in notifications.</p>
          </div>
          <div className="rounded-2xl border border-line bg-bg-elevated/50 p-6">
            <HeartHandshake size={20} className="text-violet" />
            <h2 className="mt-3 font-display text-lg font-semibold">What we value</h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-muted">Respect for your attention, your privacy and your time. Your data is yours, every device is under your control, and the free plan stays free.</p>
          </div>
        </section>

        <GlassPanel glow className="mt-10 p-6 md:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-violet">Built by</p>
          <h2 className="mt-2 font-display text-2xl font-semibold md:text-3xl">{creator.name}</h2>
          <p className="text-sm font-medium text-cyan">{creator.role} — {creator.headline}</p>
          <p className="mt-4 max-w-2xl text-ink-muted">{creator.bio}</p>
          <p className="mt-3 max-w-2xl text-ink">{creator.philosophy}</p>

          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {creator.highlights.map((h, i) => {
              const Icon = HIGHLIGHT_ICONS[i] ?? Code2;
              return (
                <div key={h.title} className="rounded-2xl border border-line bg-bg-elevated/50 p-4">
                  <Icon size={20} className="text-violet" />
                  <h3 className="mt-3 text-sm font-semibold">{h.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-ink-muted">{h.text}</p>
                </div>
              );
            })}
          </div>
        </GlassPanel>

        <section aria-labelledby="skills-h" className="mt-10">
          <h2 id="skills-h" className="font-display text-xl font-semibold">Tools I reach for</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {creator.skills.map((g) => (
              <GlassPanel key={g.category} className="p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">{g.category}</h3>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {g.items.map((s) => (
                    <li key={s} className="rounded-full border border-line bg-white/5 px-2.5 py-0.5 text-sm">{s}</li>
                  ))}
                </ul>
              </GlassPanel>
            ))}
          </div>
        </section>

        <section aria-labelledby="projects-h" className="mt-10">
          <h2 id="projects-h" className="font-display text-xl font-semibold">Other projects</h2>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {creator.projects.map((p) => (
              <li key={p.name}>
                <a href={p.url} target="_blank" rel="noreferrer" className="glass flex h-full items-start justify-between gap-3 rounded-2xl p-4 transition-colors hover:border-line-strong">
                  <span>
                    <span className="block font-medium">{p.name}</span>
                    <span className="block text-sm text-ink-muted">{p.tagline}</span>
                  </span>
                  <ExternalLink size={16} className="mt-1 shrink-0 text-ink-faint" aria-label="opens in a new tab" />
                </a>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="contact-h" className="mt-10">
          <h2 id="contact-h" className="font-display text-xl font-semibold">Get in touch</h2>
          <p className="mt-1 text-sm text-ink-muted">Open to freelance work, collaborations, or feedback on Remindora.</p>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {channels.map((ch) => (
              <li key={ch.label}>
                <a href={ch.href} target="_blank" rel="noreferrer" className="glass flex items-center gap-3 rounded-2xl p-4 transition-colors hover:border-line-strong">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-violet/10 text-violet"><ch.icon size={18} /></span>
                  <span className="min-w-0">
                    <span className="block text-xs text-ink-faint">{ch.label}</span>
                    <span className="block truncate font-medium">{ch.value}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
    </SiteShell>
  );
}
