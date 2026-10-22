'use client';
import { Button, Spinner } from '@remindora/ui';
import { CheckCircle2, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { AuthFrame } from '@/components/auth-frame';
import { api, ApiError } from '@/lib/api';

function MagicInner() {
  const params = useSearchParams();
  const [state, setState] = useState<{ kind: 'working' } | { kind: 'done'; device: string; approval: boolean } | { kind: 'error'; message: string }>({ kind: 'working' });
  const once = useRef(false);

  useEffect(() => {
    if (once.current) return;
    once.current = true;
    const challengeId = params.get('c');
    const token = params.get('t');
    if (!challengeId || !token) return setState({ kind: 'error', message: 'This link is incomplete.' });
    api<{ status: string; deviceName: string }>('/auth/email/magic', { body: { challengeId, token }, auth: false })
      .then((r) => setState({ kind: 'done', device: r.deviceName, approval: r.status === 'awaiting_approval' }))
      .catch((e) => setState({ kind: 'error', message: e instanceof ApiError ? e.message : 'This link didn’t work.' }));
  }, [params]);

  if (state.kind === 'working') {
    return (
      <AuthFrame title="Signing you in…">
        <Spinner size={24} />
      </AuthFrame>
    );
  }
  if (state.kind === 'error') {
    return (
      <AuthFrame title="Link not valid" subtitle={state.message}>
        <XCircle className="mb-4 text-danger" size={36} />
        <Link href="/login">
          <Button variant="primary">Request a new code</Button>
        </Link>
      </AuthFrame>
    );
  }
  return (
    <AuthFrame title={state.approval ? 'Almost there' : 'Verified'} subtitle={state.approval ? `Approve the sign-in on a device that’s already signed in to finish linking “${state.device}”.` : `“${state.device}” is now signed in. You can close this tab.`}>
      <CheckCircle2 className="text-success" size={36} />
    </AuthFrame>
  );
}

export default function MagicPage() {
  return (
    <Suspense>
      <MagicInner />
    </Suspense>
  );
}
