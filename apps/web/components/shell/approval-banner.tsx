'use client';
import { Button } from '@remindora/ui';
import { useQueryClient } from '@tanstack/react-query';
import { ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { keys, reportError, useNotifications } from '@/lib/queries';
import { onRealtime } from '@/lib/realtime';

/** "Approve new sign-in?" — sensitive email sign-ins wait for confirmation from a signed-in device. */
export function ApprovalBanner() {
  const { data } = useNotifications();
  const qc = useQueryClient();
  const [live, setLive] = useState<{ challengeId: string; deviceName: string; platform: string } | null>(null);
  const pending = data?.items.find((n) => n.kind === 'DEVICE_APPROVAL' && !n.acknowledgedAt);

  useEffect(() => onRealtime('device.approval_requested', (p) => setLive(p)), []);

  const challengeId = live?.challengeId ?? (pending?.data.challengeId as string | undefined) ?? null;
  if (!live && !pending) return null;
  const label = live ? `${live.deviceName} (${live.platform.toLowerCase().replace('_', ' ')})` : pending!.body;

  async function decide(approve: boolean) {
    try {
      if (!challengeId) return;
      await api(`/auth/email/challenges/${challengeId}/decide`, { body: { approve } });
      if (pending) await api(`/notifications/${pending.id}/action`, { body: { action: 'acknowledge' } }).catch(() => undefined);
      setLive(null);
      qc.invalidateQueries({ queryKey: keys.notifications });
      qc.invalidateQueries({ queryKey: keys.devices });
    } catch (e) {
      reportError(e);
    }
  }

  return (
    <div role="alertdialog" aria-labelledby="approve-title" className="mx-3 mt-3 flex flex-wrap items-center gap-3 rounded-2xl border border-amber/40 bg-amber/10 px-4 py-3 md:mx-6">
      <ShieldAlert className="text-amber" size={20} />
      <div className="min-w-0 flex-1">
        <p id="approve-title" className="text-sm font-medium text-ink">
          Approve new sign-in?
        </p>
        <p className="text-xs text-ink-muted">{label} is trying to sign in to your account. Only approve if this is you.</p>
      </div>
      <Button size="sm" variant="ghost" onClick={() => decide(false)}>
        Deny
      </Button>
      <Button size="sm" variant="amber" onClick={() => decide(true)}>
        Approve
      </Button>
    </div>
  );
}
