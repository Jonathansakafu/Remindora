'use client';
import { RemindoraMark, Spinner } from '@remindora/ui';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useSession } from '@/lib/session';

export default function Home() {
  const status = useSession((s) => s.status);
  const router = useRouter();
  useEffect(() => {
    if (status === 'signed_in') router.replace('/app/today');
    if (status === 'signed_out') router.replace('/login');
  }, [status, router]);
  return (
    <main id="main" className="grid min-h-dvh place-items-center">
      <div className="flex flex-col items-center gap-4">
        <RemindoraMark size={64} />
        <Spinner />
      </div>
    </main>
  );
}
