'use client';
import { useQueryClient } from '@tanstack/react-query';
import { AlarmClock, BellOff, Check, Volume2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { startAlarmSound, stopAlarmSound, surfaceWindow, unlockAlarmSound, useAlarm, type RingingAlarm } from '@/lib/alarm';
import { api } from '@/lib/api';
import { reportError } from '@/lib/queries';

const SNOOZE_OPTIONS = [5, 10, 15, 30];

/** Full-screen ringing alarm for due reminders (web + desktop). */
export function AlarmOverlay() {
  const current = useAlarm((s) => s.queue[0]);
  const dismiss = useAlarm((s) => s.dismiss);
  const qc = useQueryClient();
  const [blocked, setBlocked] = useState(false);
  const [now, setNow] = useState(() => new Date());

  // Prime audio on the first interaction so a later alarm can ring without a click.
  useEffect(() => {
    const unlock = () => unlockAlarmSound();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  useEffect(() => {
    if (!current) {
      stopAlarmSound();
      return;
    }
    setNow(new Date());
    void surfaceWindow();
    void startAlarmSound(current.sound).then((ok) => setBlocked(!ok));
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, [current]);

  if (!current) return null;

  async function act(a: RingingAlarm, action: 'acknowledge' | 'complete' | 'snooze', snoozeMinutes?: number) {
    dismiss(a.notificationId);
    if (a.test) return;
    try {
      await api(`/notifications/${a.notificationId}/action`, { body: snoozeMinutes ? { action, snoozeMinutes } : { action } });
      qc.invalidateQueries({ queryKey: ['tasks'] });
    } catch (e) {
      reportError(e, 'Couldn’t update the reminder');
    }
  }

  return (
    <div role="alertdialog" aria-modal="true" aria-labelledby="alarm-title" aria-describedby="alarm-body" className="fixed inset-0 z-[100] grid place-items-center bg-bg/95 p-6 backdrop-blur-xl">
      <div className="flex w-full max-w-md flex-col items-center text-center">
        <span className="relative grid h-28 w-28 place-items-center">
          <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-cyan/25 motion-reduce:hidden" />
          <span className="relative grid h-24 w-24 place-items-center rounded-full bg-cyan text-on-accent shadow-[0_0_60px_rgb(96_233_255/0.45)]">
            <AlarmClock size={44} />
          </span>
        </span>
        <p className="mt-6 font-display text-5xl font-semibold tabular-nums tracking-tight">{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}</p>
        <h2 id="alarm-title" className="mt-4 font-display text-3xl font-semibold leading-tight">
          {current.title}
        </h2>
        <p id="alarm-body" className="mt-2 text-ink-muted">
          {current.body}
        </p>

        {blocked && (
          <button type="button" onClick={() => void startAlarmSound(current.sound).then((ok) => setBlocked(!ok))} className="mt-4 inline-flex items-center gap-2 rounded-xl border border-amber/40 bg-amber/10 px-3 py-2 text-sm text-amber">
            <Volume2 size={16} /> Tap to play the alarm sound
          </button>
        )}

        <button type="button" autoFocus onClick={() => act(current, 'acknowledge')} className="mt-8 inline-flex h-16 w-full items-center justify-center gap-2 rounded-2xl bg-cyan text-xl font-semibold text-on-accent hover:brightness-110">
          <BellOff size={22} /> Stop
        </button>
        <div className="mt-3 grid w-full grid-cols-4 gap-2" role="group" aria-label="Snooze">
          {SNOOZE_OPTIONS.map((m) => (
            <button key={m} type="button" onClick={() => act(current, 'snooze', m)} className="glass h-12 rounded-xl text-sm font-medium hover:border-line-strong">
              Snooze {m}m
            </button>
          ))}
        </div>
        {current.taskId && (
          <button type="button" onClick={() => act(current, 'complete')} className="mt-3 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-medium text-ink-muted hover:text-ink">
            <Check size={17} /> Mark as done
          </button>
        )}
      </div>
    </div>
  );
}
