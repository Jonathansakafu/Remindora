'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect } from 'react';
import { useUi } from '@/lib/ui-store';

/** Deep link (from notifications, emails, widgets): opens the task panel over Today. */
function Inner() {
  const id = useSearchParams().get('id');
  const router = useRouter();
  const select = useUi((s) => s.selectTask);
  useEffect(() => {
    if (id) select(id);
    router.replace('/app/reminders');
  }, [id, select, router]);
  return null;
}

export default function Page() {
  return (
    <Suspense>
      <Inner />
    </Suspense>
  );
}
