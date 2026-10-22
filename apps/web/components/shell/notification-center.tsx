'use client';
import { Button, cn, EmptyState, PriorityFlag, Sheet } from '@remindora/ui';
import type { PriorityKey } from '@remindora/ui';
import type { NotificationDTO } from '@remindora/types';
import { useQueryClient } from '@tanstack/react-query';
import { BellOff, Check, CheckCheck, Clock, X } from 'lucide-react';
import { DateTime } from 'luxon';
import { api } from '@/lib/api';
import { relative } from '@/lib/dates';
import { keys, reportError, scheduleTaskRefetch, useNotifications } from '@/lib/queries';
import { useUi } from '@/lib/ui-store';

export function NotificationList({ compact }: { compact?: boolean }) {
  const { data } = useNotifications();
  const qc = useQueryClient();
  const select = useUi((s) => s.selectTask);
  const setOpen = useUi((s) => s.setNotifications);

  async function act(n: NotificationDTO, action: 'complete' | 'snooze' | 'stop' | 'acknowledge' | 'reschedule', extra: Record<string, unknown> = {}) {
    try {
      await api(`/notifications/${n.id}/action`, { body: { action, ...extra } });
      qc.invalidateQueries({ queryKey: keys.notifications });
      if (action === 'complete' || action === 'reschedule') scheduleTaskRefetch(qc);
    } catch (e) {
      reportError(e);
    }
  }

  if (!data?.items.length) return <EmptyState icon={<BellOff size={22} />} title="All quiet" body="Reminders, mentions and assignments will appear here." />;
  return (
    <ul className="space-y-2">
      {data.items.map((n) => {
        const open = !n.acknowledgedAt;
        const reminder = n.actions.includes('snooze');
        return (
          <li key={n.id} className={cn('rounded-2xl border p-3 transition-opacity', open ? 'border-line-strong bg-surface/70' : 'border-line opacity-60')}>
            <button
              type="button"
              className="w-full text-left"
              onClick={() => {
                void api(`/notifications/${n.id}/read`, { method: 'POST' }).catch(() => undefined);
                if (n.taskId) {
                  select(n.taskId);
                  setOpen(false);
                }
              }}
            >
              <div className="flex items-center gap-2">
                {!n.readAt && <span className="h-2 w-2 shrink-0 rounded-full bg-cyan" aria-label="Unread" />}
                <span className="flex-1 truncate text-sm font-medium text-ink">{n.title}</span>
                <PriorityFlag priority={n.priority as PriorityKey} />
              </div>
              <p className="mt-0.5 text-xs text-ink-muted">{n.body}</p>
              <p className="mt-1 text-[11px] text-ink-faint">{relative(n.createdAt)}</p>
            </button>
            {open && reminder && !compact && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Button size="sm" variant="primary" onClick={() => act(n, 'complete')}>
                  <Check size={14} /> Complete
                </Button>
                <Button size="sm" onClick={() => act(n, 'snooze', { snoozeMinutes: 10 })}>
                  <Clock size={14} /> 10m
                </Button>
                <Button size="sm" onClick={() => act(n, 'snooze', { snoozeMinutes: 60 })}>1h</Button>
                <Button size="sm" onClick={() => act(n, 'reschedule', { rescheduleTo: DateTime.now().plus({ days: 1 }).set({ hour: 9, minute: 0 }).toUTC().toISO() })}>Tomorrow</Button>
                <Button size="sm" variant="ghost" onClick={() => act(n, 'stop')}>
                  <BellOff size={14} /> Stop reminders
                </Button>
              </div>
            )}
            {open && !reminder && n.kind === 'DEVICE_APPROVAL' && <p className="mt-2 text-xs text-amber">Review this sign-in in the banner at the top of the app.</p>}
          </li>
        );
      })}
    </ul>
  );
}

export function NotificationCenter() {
  const open = useUi((s) => s.notificationsOpen);
  const setOpen = useUi((s) => s.setNotifications);
  const qc = useQueryClient();
  return (
    <Sheet open={open} onOpenChange={setOpen} title="Notifications">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <h2 className="font-display text-base font-semibold">Notifications</h2>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          onClick={async () => {
            await api('/notifications/read-all', { method: 'POST' });
            qc.invalidateQueries({ queryKey: keys.notifications });
          }}
        >
          <CheckCheck size={14} /> Mark all read
        </Button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-1.5 text-ink-faint hover:bg-white/5" aria-label="Close notifications">
          <X size={16} />
        </button>
      </div>
      <div className="scroll-thin flex-1 overflow-y-auto p-3">
        <NotificationList />
      </div>
    </Sheet>
  );
}
