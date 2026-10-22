'use client';
import { Button, cn, Popover, PopoverContent, PopoverTrigger, Tooltip } from '@remindora/ui';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CloudOff, RefreshCw, Wifi } from 'lucide-react';
import { api } from '@/lib/api';
import { flushOutbox, useSync } from '@/lib/offline';
import { scheduleTaskRefetch } from '@/lib/queries';

/** Sync status indicator + conflict resolution (keep mine / keep theirs). */
export function SyncStatus() {
  const { online, pending, syncing, conflicts, resolve } = useSync();
  const qc = useQueryClient();
  const tone = conflicts.length ? 'text-amber' : !online ? 'text-ink-faint' : pending || syncing ? 'text-cyan' : 'text-success';
  const label = conflicts.length ? `${conflicts.length} conflict${conflicts.length > 1 ? 's' : ''}` : !online ? `Offline${pending ? ` · ${pending} queued` : ''}` : syncing || pending ? `Syncing ${pending}` : 'Synced';
  const Icon = conflicts.length ? AlertTriangle : !online ? CloudOff : syncing ? RefreshCw : Wifi;
  return (
    <Popover>
      <Tooltip label={label}>
        <PopoverTrigger className={cn('inline-flex h-9 items-center gap-1.5 rounded-xl px-2 text-xs font-medium hover:bg-white/5', tone)} aria-label={`Sync status: ${label}`}>
          <Icon size={15} className={cn(syncing && 'animate-spin')} />
          <span className="hidden lg:inline">{label}</span>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent align="end" className="w-80">
        <p className="text-sm font-medium">{label}</p>
        <p className="mt-1 text-xs text-ink-muted">{online ? 'Changes save instantly and appear on your other devices in real time.' : 'You can keep working. Changes are stored on this device and sync automatically when you reconnect.'}</p>
        {online && pending > 0 && (
          <Button size="sm" className="mt-3" onClick={() => flushOutbox(() => scheduleTaskRefetch(qc))}>
            Sync now
          </Button>
        )}
        {conflicts.map((c) => (
          <div key={c.id} className="mt-3 rounded-xl border border-amber/30 bg-amber/5 p-3">
            <p className="text-sm text-ink">“{c.server.title}”</p>
            <p className="mt-0.5 text-xs text-ink-muted">Changed on another device while you were offline: {c.fields.join(', ')}.</p>
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                variant="primary"
                onClick={async () => {
                  const { baseVersion: _b, ...mine } = c.mine;
                  await api(`/tasks/${c.taskId}`, { method: 'PATCH', body: { ...mine, force: true } });
                  resolve(c.id);
                  scheduleTaskRefetch(qc);
                }}
              >
                Keep mine
              </Button>
              <Button size="sm" variant="ghost" onClick={() => resolve(c.id)}>
                Keep theirs
              </Button>
            </div>
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}
