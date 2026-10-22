'use client';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { NotificationList } from '@/components/shell/notification-center';
import { PageHeader } from '@/components/views/common';
import { api } from '@/lib/api';
import { keys, reportError } from '@/lib/queries';

/** Full-page notification center; also completes one-tap actions coming from the web push service worker. */
function Inner() {
  const params = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const done = useRef(false);
  useEffect(() => {
    const act = params.get('act');
    const id = params.get('id');
    if (done.current || !act || !id) return;
    done.current = true;
    api(`/notifications/${id}/action`, { body: act === 'snooze' ? { action: 'snooze', snoozeMinutes: 10 } : { action: 'complete' } })
      .then(() => toast.success(act === 'snooze' ? 'Snoozed for 10 minutes' : 'Completed'))
      .catch(reportError)
      .finally(() => {
        qc.invalidateQueries({ queryKey: keys.notifications });
        router.replace('/app/notifications');
      });
  }, [params, qc, router]);
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Notifications" />
      <div className="px-4 md:px-8"><NotificationList /></div>
    </div>
  );
}

export default function NotificationsPage() {
  return <Suspense><Inner /></Suspense>;
}
