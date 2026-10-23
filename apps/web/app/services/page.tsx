import { GlassPanel } from '@remindora/ui';
import { ArrowRight, BarChart3, BellRing, CalendarDays, Check, Flame, Link2, ListChecks, QrCode, ShieldCheck, Timer, Users } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteShell } from '@/components/marketing/site-shell';

export const metadata: Metadata = {
  title: 'Services',
  description: 'Task management, smart reminders, calendar planning, habits, focus, collaboration and cross-device sync — everything Remindora offers.',
};

const SERVICES = [
  {
    icon: ListChecks,
    title: 'Task & project management',
    text: 'Organise work into projects and sections with subtasks, checklists, tags, due dates and recurring tasks.',
    points: ['List, Kanban and Eisenhower Matrix views', 'Natural-language quick add', 'Recurring tasks and templates'],
  },
  {
    icon: BellRing,
    title: 'Smart, priority-aware reminders',
    text: 'Reminders that adapt to how important a task is — persistent for critical work, gentle for the rest.',
    points: ['Push notifications on Android, desktop and browser', 'Email reminders and daily digests', 'Quiet hours and snooze'],
  },
  {
    icon: CalendarDays,
    title: 'Calendar planning',
    text: 'See tasks and deadlines on a real calendar and block time for what matters.',
    points: ['Day, week and month views', 'Drag-and-drop time-blocking', 'Show your Google, Apple or Outlook calendars alongside tasks'],
  },
  {
    icon: Flame,
    title: 'Habit tracking',
    text: 'Build routines that stick with flexible goals, streaks and progress history.',
    points: ['Daily, weekly or custom schedules', 'Streaks and heatmaps', 'Gentle check-in reminders'],
  },
  {
    icon: Timer,
    title: 'Focus sessions',
    text: 'Pomodoro and deep-work timers linked to your tasks, so you know where your time goes.',
    points: ['Customisable work and break lengths', 'Time logged per task', 'Session history'],
  },
  {
    icon: Users,
    title: 'Team collaboration',
    text: 'Share projects with family, classmates or colleagues and stay in sync without the group chat chaos.',
    points: ['Shared workspaces and roles', 'Assignments and comments', 'Live updates for everyone'],
  },
  {
    icon: BarChart3,
    title: 'Insights & reports',
    text: 'Understand your productivity with completion trends, focus time and habit analytics.',
    points: ['Weekly and monthly trends', 'Exportable CSV reports', 'Overdue and workload overview'],
  },
  {
    icon: Link2,
    title: 'Sync across every device',
    text: 'One account on the web, Windows, macOS, Linux and Android — changes appear everywhere instantly.',
    points: ['Real-time sync', 'Keeps working offline and catches up', 'Link a new device by QR code or email'],
  },
];

const TRUST = [
  { icon: ShieldCheck, title: 'Private by design', text: 'Encrypted connections, secure password storage and new-device alerts.' },
  { icon: QrCode, title: 'Safe device linking', text: 'Approve new sign-ins from a device you already trust.' },
];

export default function ServicesPage() {
  return (
    <SiteShell>
      <section className="relative px-4 pb-10 pt-14 md:pt-20">
        <div aria-hidden className="pointer-events-none absolute left-1/2 top-[-20%] h-[560px] w-[560px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgb(165_140_255/0.14),transparent_62%)]" />
        <div className="relative mx-auto max-w-3xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan">Services</p>
          <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight md:text-5xl">Everything you need to stay on top of your day</h1>
          <p className="mx-auto mt-4 max-w-2xl text-ink-muted md:text-lg">From a single to-do to a whole team’s projects — Remindora helps you plan, focus and follow through.</p>
        </div>
      </section>

      <section aria-label="What Remindora offers" className="px-4 py-10">
        <ul className="mx-auto grid max-w-6xl gap-4 md:grid-cols-2">
          {SERVICES.map((s) => (
            <li key={s.title}>
              <GlassPanel className="h-full p-6 md:p-7">
                <div className="flex items-start gap-4">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-cyan/12 text-cyan">
                    <s.icon size={20} />
                  </span>
                  <div>
                    <h2 className="font-display text-xl font-semibold">{s.title}</h2>
                    <p className="mt-2 text-sm leading-relaxed text-ink-muted">{s.text}</p>
                    <ul className="mt-4 space-y-1.5">
                      {s.points.map((p) => (
                        <li key={p} className="flex items-start gap-2 text-sm">
                          <Check size={15} className="mt-0.5 shrink-0 text-success" /> {p}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </GlassPanel>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="plans-h" className="px-4 py-14">
        <div className="mx-auto max-w-3xl">
          <GlassPanel glow className="p-8 text-center md:p-10">
            <h2 id="plans-h" className="font-display text-3xl font-semibold tracking-tight">
              Free. Everything included.
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-ink-muted">No plans, no trials, no locked features. Every service on this page is available to everyone, on every device.</p>
            <ul className="mx-auto mt-6 grid max-w-xl gap-2 text-left text-sm sm:grid-cols-2">
              {['Unlimited-feeling lists and tasks', 'Reminders on phone, desktop, browser and email', 'Calendar, habits, focus and reports', 'Teams, sharing and full history'].map((p) => (
                <li key={p} className="flex gap-2">
                  <Check size={15} className="mt-0.5 shrink-0 text-success" /> {p}
                </li>
              ))}
            </ul>
            <Link href="/register" className="mt-8 inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-cyan px-6 font-semibold text-on-accent hover:brightness-110">
              Create your free account <ArrowRight size={16} />
            </Link>
          </GlassPanel>
        </div>
      </section>

      <section aria-label="Security" className="px-4 pb-20">
        <div className="mx-auto grid max-w-4xl gap-4 sm:grid-cols-2">
          {TRUST.map((t) => (
            <div key={t.title} className="flex gap-3 rounded-2xl border border-line bg-bg-elevated/50 p-5">
              <t.icon size={20} className="mt-0.5 shrink-0 text-violet" />
              <div>
                <h2 className="text-sm font-semibold">{t.title}</h2>
                <p className="mt-1 text-sm text-ink-muted">{t.text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </SiteShell>
  );
}
