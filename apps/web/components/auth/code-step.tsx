'use client';
import { Button, Field, Input, Spinner } from '@remindora/ui';
import type { AuthTokensDTO } from '@remindora/types';
import { ShieldCheck } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { AuthFrame } from '@/components/auth-frame';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';

export interface Challenge {
  email: string;
  challengeId: string;
  pollSecret: string;
}

/**
 * Enter the emailed 6-digit code. Also polls, so a magic link opened on another
 * device (or an approval from a signed-in device) completes this sign-in.
 */
export function CodeStep({ challenge, title, subtitle, submitLabel, onBack, backLabel }: { challenge: Challenge; title: string; subtitle: string; submitLabel: string; onBack: (error?: string) => void; backLabel: string }) {
  const accept = useSession((s) => s.accept);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [awaitingApproval, setAwaitingApproval] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => codeRef.current?.focus(), []);

  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const res = await api<{ status: string; tokens?: AuthTokensDTO }>(`/auth/email/challenges/${challenge.challengeId}/poll`, { body: { pollSecret: challenge.pollSecret }, auth: false });
        if (res.status === 'signed_in' && res.tokens) await accept(res.tokens);
        if (res.status === 'rejected') onBack('The sign-in was declined on your other device.');
        if (res.status === 'expired') onBack('That code expired. Request a new one.');
      } catch {
        /* keep polling */
      }
    }, 2500);
    return () => clearInterval(t);
  }, [challenge, accept, onBack]);

  async function verify(e?: React.FormEvent) {
    e?.preventDefault();
    if (code.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ status: string; tokens?: AuthTokensDTO }>('/auth/email/verify', { body: { challengeId: challenge.challengeId, code, pollSecret: challenge.pollSecret }, auth: false });
      if (res.status === 'awaiting_approval') setAwaitingApproval(true);
      else if (res.tokens) await accept(res.tokens);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Couldn’t verify that code.');
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (code.length === 6) void verify();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  if (awaitingApproval) {
    return (
      <AuthFrame title="Approve on your other device" subtitle="For your security, this sign-in needs a confirmation from a device that’s already signed in.">
        <div className="flex items-center gap-3 rounded-2xl border border-line bg-bg-elevated/60 p-4 text-sm text-ink-muted">
          <ShieldCheck className="shrink-0 text-cyan" size={22} />
          Open Remindora on a signed-in device and tap <strong className="text-ink">Approve</strong>. This page continues automatically.
        </div>
        <div className="mt-5 flex items-center gap-2 text-sm text-ink-faint">
          <Spinner size={14} /> Waiting for approval…
        </div>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame title={title} subtitle={subtitle}>
      <form onSubmit={verify} className="space-y-4">
        <Field label="Verification code" htmlFor="code">
          <Input
            id="code"
            ref={codeRef}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            className="h-14 text-center font-display text-2xl tracking-[0.5em]"
            aria-describedby={error ? 'code-error' : undefined}
          />
        </Field>
        {error && (
          <p id="code-error" role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy || code.length !== 6}>
          {busy ? <Spinner className="text-on-accent" /> : submitLabel}
        </Button>
        <button type="button" className="w-full text-center text-sm text-ink-muted hover:text-ink" onClick={() => onBack()}>
          {backLabel}
        </button>
        <p className="text-center text-xs text-ink-faint">Codes expire in 10 minutes and work once. Check your spam folder if it doesn’t arrive.</p>
      </form>
    </AuthFrame>
  );
}
