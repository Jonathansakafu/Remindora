'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { isTauri } from '@/lib/platform';
import { useSession } from '@/lib/session';

/** The desktop app opens straight into the workspace (or sign-in), never the marketing site. */
export function DesktopRedirect() {
  const router = useRouter();
  const status = useSession((s) => s.status);
  useEffect(() => {
    if (!isTauri()) return;
    if (status === 'signed_in') router.replace('/app/reminders');
    if (status === 'signed_out') router.replace('/login');
  }, [status, router]);
  return null;
}
