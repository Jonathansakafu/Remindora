'use client';
import { Button } from '@remindora/ui';
import { BellRing, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { unlockAlarmSound } from '@/lib/alarm';
import { enableDeviceNotifications, notificationPermission, syncWebPush } from '@/lib/device-notifications';
import { isTauri } from '@/lib/platform';
import { reportError } from '@/lib/queries';

const DISMISS_KEY = 'rmd.notifyPrompt.dismissedAt';
const SNOOZE_MS = 7 * 86_400_000;

function dismissedRecently() {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
    return Date.now() - at < SNOOZE_MS;
  } catch {
    return false;
  }
}

/**
 * Like other apps: ask once to allow notifications on this device, and keep an
 * existing browser-push subscription linked to the current sign-in.
 */
export function NotificationPrompt() {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const permission = await notificationPermission();
      if (permission === 'granted') {
        await syncWebPush().catch(() => undefined);
        return;
      }
      if (permission === 'default' && !dismissedRecently() && !cancelled) setShow(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!show) return null;

  async function enable() {
    setBusy(true);
    unlockAlarmSound(); // this click also lets the alarm ring with sound later
    try {
      const result = await enableDeviceNotifications();
      if (result === 'granted') toast.success(isTauri() ? 'Desktop notifications are on' : 'Notifications are on for this browser');
      else if (result === 'denied') toast('Notifications are blocked. You can allow them in your browser or system settings.');
      setShow(false);
    } catch (e) {
      reportError(e, 'Couldn’t turn on notifications');
    } finally {
      setBusy(false);
    }
  }

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* private mode */
    }
    setShow(false);
  }

  return (
    <div role="region" aria-labelledby="notify-prompt-title" className="mx-3 mt-3 flex flex-wrap items-center gap-3 rounded-2xl border border-cyan/35 bg-cyan/10 px-4 py-3 md:mx-6">
      <BellRing className="shrink-0 text-cyan" size={20} />
      <div className="min-w-0 flex-1">
        <p id="notify-prompt-title" className="text-sm font-medium text-ink">
          Turn on notifications
        </p>
        <p className="text-xs text-ink-muted">Get reminders on this {isTauri() ? 'computer' : 'device'} even when Remindora is closed — just like your other apps.</p>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="primary" onClick={enable} disabled={busy}>
          Turn on
        </Button>
        <Button size="sm" variant="ghost" onClick={dismiss}>
          Not now
        </Button>
        <button type="button" onClick={dismiss} aria-label="Dismiss" className="grid h-8 w-8 place-items-center rounded-lg text-ink-faint hover:text-ink">
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
