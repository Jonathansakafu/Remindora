'use client';
import { Button, Spinner } from '@remindora/ui';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { AuthFrame } from '@/components/auth-frame';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';

function InviteInner() {
  const params = useSearchParams();
  const router = useRouter();
  const status = useSession((s) => s.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const token = params.get('t') ?? '';

  if (status === 'loading') return <AuthFrame title="Loading…"><Spinner /></AuthFrame>;
  if (status === 'signed_out') {
    return (
      <AuthFrame title="You’re invited" subtitle="Sign in with the email address the invite was sent to, then open the invite link again.">
        <Link href="/login"><Button variant="primary">Sign in</Button></Link>
      </AuthFrame>
    );
  }
  return (
    <AuthFrame title="Join the workspace" subtitle="Accept to start collaborating on shared lists and tasks.">
      {error && <p role="alert" className="mb-4 text-sm text-danger">{error}</p>}
      <Button
        variant="primary"
        disabled={busy || !token}
        onClick={async () => {
          setBusy(true);
          try {
            await api('/invites/accept', { body: { token } });
            router.replace('/app/reminders');
          } catch (e) {
            setError(e instanceof ApiError ? e.message : 'Couldn’t accept this invite.');
          } finally {
            setBusy(false);
          }
        }}
      >
        Accept invite
      </Button>
    </AuthFrame>
  );
}

export default function InvitePage() {
  return (
    <Suspense>
      <InviteInner />
    </Suspense>
  );
}
