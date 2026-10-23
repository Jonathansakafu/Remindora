import { GlassPanel } from '@remindora/ui';
import { ArrowRight, BellRing, CalendarDays, CheckCircle2, Flame, Layers3, MonitorSmartphone, Sparkles, Timer, Users, Zap } from 'lucide-react';
import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { DownloadList } from '@/components/download-list';
import { DesktopRedirect } from '@/components/marketing/desktop-redirect';
import { SiteShell } from '@/components/marketing/site-shell';

export const metadata: Metadata = {
  title: 'Remindora — tasks, calendar and reminders that know what matters',
  description: 'Capture tasks in seconds, plan your week on a calendar, build habits, focus deeply and get priority-aware reminders on web, desktop and Android.',
};

const FEATURES = [
  { icon: Zap, title: 'Capture in seconds', text: 'Type “Call Amina tomorrow 9am !high” and Remindora sets the date, time and priority for you.' },
  { icon: BellRing, title: 'Reminders that know what matters', text: 'Critical tasks keep nudging until they’re done; low-priority ones wait for a quiet moment. No more alert fatigue.' },
  { icon: CalendarDays, title: 'Calendar & time-blocking', text: 'Drag tasks onto your week, see deadlines next to your schedule and plan days that actually fit.' },
  { icon: Flame, title: 'Habits & streaks', text: 'Build routines with daily or weekly goals, gentle check-ins and a heatmap of your progress.' },
  { icon: Timer, title: 'Focus sessions', text: 'Start a Pomodoro on any task. Remindora tracks the time and keeps distractions on hold.' },
  { icon: Users, title: 'Work together', text: 'Share projects, assign tasks, comment and watch updates arrive in real time.' },
];

const STEPS = [
  { title: 'Create your free account', text: 'Sign up with your email in under a minute. No card needed.' },
  { title: 'Capture everything', text: 'Add tasks from the web, your desktop or your phone — they sync instantly.' },
  { title: 'Get reminded at the right time', text: 'Push, email and in-app reminders follow the priority you set.' },
];

const PLATFORMS = ['Web', 'Windows', 'macOS', 'Linux', 'Android'];

export default function Home() {
  return (
    <SiteShell>
      <DesktopRedirect />

      {/* Hero */}
      <section className="relative px-4 pb-16 pt-14 md:pb-24 md:pt-20">
        <div aria-hidden className="pointer-events-none absolute left-1/2 top-[-10%] h-[720px] w-[720px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgb(81_228_255/0.16),transparent_62%)]" />
        <div className="relative mx-auto max-w-6xl">
          <div className="mx-auto max-w-3xl text-center">
            <p className="inline-flex items-center gap-2 rounded-full border border-line bg-bg-elevated/60 px-3 py-1 text-xs font-medium text-ink-muted">
              <Sparkles size={13} className="text-cyan" /> Free to start · Web, desktop & Android
            </p>
            <h1 className="mt-6 font-display text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl md:text-6xl">
              Remember what matters.
              <span className="block bg-gradient-to-r from-cyan to-violet bg-clip-text text-transparent">Do it on time.</span>
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-ink-muted md:text-lg">
              Remindora brings your tasks, calendar, habits and focus time together — and reminds you based on what’s actually important.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link href="/register" className="inline-flex h-12 items-center gap-2 rounded-xl bg-cyan px-6 text-base font-semibold text-on-accent shadow-[0_8px_24px_-8px_rgb(96_233_255/0.6)] hover:bg-[#8af0ff]">
                Get started free <ArrowRight size={17} />
              </Link>
              <Link href="#download" className="glass inline-flex h-12 items-center gap-2 rounded-xl px-6 text-base font-medium hover:border-line-strong">
                <MonitorSmartphone size={17} /> Download the apps
              </Link>
            </div>
            <ul className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm text-ink-faint" aria-label="Available on">
              {PLATFORMS.map((p) => (
                <li key={p} className="inline-flex items-center gap-1.5">
                  <CheckCircle2 size={14} className="text-cyan" /> {p}
                </li>
              ))}
            </ul>
          </div>

          <div className="relative mx-auto mt-14 max-w-5xl">
            <GlassPanel strong glow className="overflow-hidden p-2">
              <Image src="/screens/02-today.png" alt="The Today view: tasks for the day grouped by priority, with a focus timer and upcoming reminders" width={1600} height={1000} priority className="h-auto w-full rounded-xl" />
            </GlassPanel>
            <div className="absolute -bottom-8 -right-2 hidden w-[22%] overflow-hidden rounded-[1.6rem] border border-line-strong bg-bg shadow-2xl sm:block md:-right-8">
              <Image src="/screens/10-mobile-today.png" alt="Remindora on an Android phone" width={390} height={844} className="h-auto w-full" />
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section aria-labelledby="features-h" className="px-4 py-16 md:py-24">
        <div className="mx-auto max-w-6xl">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan">Everything in one place</p>
            <h2 id="features-h" className="mt-3 font-display text-3xl font-semibold tracking-tight md:text-4xl">
              Built for busy days, not for more busywork
            </h2>
          </div>
          <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <li key={f.title}>
                <GlassPanel className="h-full p-6">
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-cyan/12 text-cyan">
                    <f.icon size={20} />
                  </span>
                  <h3 className="mt-4 font-display text-lg font-semibold">{f.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-muted">{f.text}</p>
                </GlassPanel>
              </li>
            ))}
          </ul>
          <p className="mt-8">
            <Link href="/services" className="inline-flex items-center gap-1.5 text-sm font-medium text-cyan hover:underline">
              See all services <ArrowRight size={15} />
            </Link>
          </p>
        </div>
      </section>

      {/* Showcase */}
      <section aria-labelledby="showcase-h" className="px-4 py-16 md:py-24">
        <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-violet">Plan with confidence</p>
            <h2 id="showcase-h" className="mt-3 font-display text-3xl font-semibold tracking-tight md:text-4xl">
              See your week, then make it happen
            </h2>
            <ul className="mt-6 space-y-4">
              {[
                { icon: CalendarDays, text: 'Week and month calendars with drag-and-drop time-blocking.' },
                { icon: Layers3, text: 'List, Kanban and Eisenhower Matrix views for every project.' },
                { icon: Flame, text: 'Habit streaks and analytics that show where your time goes.' },
              ].map((r) => (
                <li key={r.text} className="flex gap-3">
                  <r.icon size={20} className="mt-0.5 shrink-0 text-violet" />
                  <span className="text-ink-muted">{r.text}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="grid gap-4">
            <GlassPanel className="overflow-hidden p-2">
              <Image src="/screens/04-calendar-week.png" alt="Week calendar with tasks time-blocked between meetings" width={1600} height={1000} className="h-auto w-full rounded-xl" />
            </GlassPanel>
            <GlassPanel className="overflow-hidden p-2">
              <Image src="/screens/06-habits.png" alt="Habits with streaks and a progress heatmap" width={1600} height={1000} className="h-auto w-full rounded-xl" />
            </GlassPanel>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section aria-labelledby="how-h" className="px-4 py-16 md:py-24">
        <div className="mx-auto max-w-6xl">
          <h2 id="how-h" className="text-center font-display text-3xl font-semibold tracking-tight md:text-4xl">
            Up and running in three steps
          </h2>
          <ol className="mt-10 grid gap-4 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="rounded-2xl border border-line bg-bg-elevated/50 p-6">
                <span className="font-display text-sm font-semibold text-cyan">0{i + 1}</span>
                <h3 className="mt-2 font-display text-lg font-semibold">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-muted">{s.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Download */}
      <section id="download" aria-labelledby="download-h" className="scroll-mt-20 px-4 py-16 md:py-24">
        <div className="mx-auto max-w-6xl">
          <GlassPanel strong className="p-6 md:p-10">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan">Download</p>
            <h2 id="download-h" className="mt-3 font-display text-3xl font-semibold tracking-tight">
              Get Remindora on every device
            </h2>
            <p className="mt-2 max-w-2xl text-ink-muted">One account, synced everywhere. Or just use it right here in your browser.</p>
            <div className="mt-8">
              <DownloadList />
            </div>
          </GlassPanel>
        </div>
      </section>

      {/* Final CTA */}
      <section className="px-4 pb-20 pt-4">
        <div className="mx-auto max-w-4xl rounded-3xl border border-cyan/25 bg-[linear-gradient(135deg,rgb(96_233_255/0.14),rgb(165_140_255/0.12))] p-8 text-center md:p-12">
          <h2 className="font-display text-3xl font-semibold tracking-tight">Start remembering what matters</h2>
          <p className="mx-auto mt-3 max-w-xl text-ink-muted">Free forever for personal use. Create your account in under a minute.</p>
          <Link href="/register" className="mt-7 inline-flex h-12 items-center gap-2 rounded-xl bg-cyan px-6 font-semibold text-on-accent hover:bg-[#8af0ff]">
            Create free account <ArrowRight size={17} />
          </Link>
        </div>
      </section>
    </SiteShell>
  );
}
