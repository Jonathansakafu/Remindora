import { GlassPanel } from '@remindora/ui';
import { BellRing, PlusSquare, Share, Smartphone } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteShell } from '@/components/marketing/site-shell';

export const metadata: Metadata = { title: 'Remindora on iPhone & iPad', description: 'Install Remindora on your iPhone or iPad for free from Safari, with notifications.' };

const STEPS = [
  { icon: Smartphone, title: 'Open Remindora in Safari', text: 'On your iPhone or iPad, open this website in Safari (not Chrome or another app’s browser).' },
  { icon: Share, title: 'Tap the Share button', text: 'It’s the square with an arrow pointing up, at the bottom of the screen on iPhone or the top on iPad.' },
  { icon: PlusSquare, title: 'Choose “Add to Home Screen”', text: 'Scroll down the share menu, tap Add to Home Screen, then Add. The Remindora icon appears with your other apps.' },
  { icon: BellRing, title: 'Open it and turn on notifications', text: 'Open Remindora from the home-screen icon, sign in, and tap “Turn on” when it offers notifications. Reminders now pop up like any other app.' },
];

export default function IosPage() {
  return (
    <SiteShell>
      <section className="px-4 py-14 md:py-20">
        <div className="mx-auto max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan">iPhone & iPad</p>
          <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight">Install Remindora on your iPhone</h1>
          <p className="mt-3 text-ink-muted">Free, no App Store needed. It runs full-screen with its own icon and sends notifications — iOS 16.4 or newer.</p>
          <ol className="mt-10 space-y-4">
            {STEPS.map((s, i) => (
              <li key={s.title}>
                <GlassPanel className="flex gap-4 p-5">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-cyan/12 text-cyan">
                    <s.icon size={20} />
                  </span>
                  <div>
                    <h2 className="font-display text-lg font-semibold">
                      {i + 1}. {s.title}
                    </h2>
                    <p className="mt-1 text-sm leading-relaxed text-ink-muted">{s.text}</p>
                  </div>
                </GlassPanel>
              </li>
            ))}
          </ol>
          <p className="mt-8 text-sm text-ink-faint">
            Notifications only work from the home-screen icon, not from a normal Safari tab — that’s an Apple rule. Already installed?{' '}
            <Link href="/login" className="text-cyan hover:underline">
              Sign in
            </Link>
            .
          </p>
        </div>
      </section>
    </SiteShell>
  );
}
