'use client';
import { Button, Field, Input, Spinner } from '@remindora/ui';
import { Mail, ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { AuthFrame } from '@/components/auth-frame';
import { api, ApiError } from '@/lib/api';
import { API_URL } from '@/lib/config';
import { deviceInfo, isTauri } from '@/lib/platform';
import { useSession } from '@/lib/session';
import type { AuthTokensDTO } from '@remindora/types';
import { useSearchParams } from 'next/navigation';

type Step = { kind: 'email' } | { kind: 'code'; email: string; challengeId: string; pollSecret: string } | { kind: 'approval'; email: string; challengeId: string; pollSecret: string };

const OAUTH_LABELS: Record<string, string> = { google: 'Continue with Google', github: 'Continue with GitHub', microsoft: 'Continue with Microsoft' };

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const status = useSession((s) => s.status);
  const accept = useSession((s) => s.accept);
  const [step, setStep] = useState<Step>({ kind: 'email' });
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(params.get('error') ? 'Sign-in with that provider didn’t complete. Try again or use email.' : null);
  const [providers, setProviders] = useState<string[]>([]);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (status === 'signed_in') router.replace('/app/today');
  }, [status, router]);
  useEffect(() => {
    api<{ oauth: string[] }>('/auth/providers', { auth: false }).then((p) => setProviders(p.oauth)).catch(() => undefined);
  }, []);

  // While waiting on a code or an approval, poll: the magic link (possibly opened on another device) or the approval completes it.
  useEffect(() => {
    if (step.kind === 'email') return;
    const t = setInterval(async () => {
      try {
        const res = await api<{ status: string; tokens?: AuthTokensDTO }>(`/auth/email/challenges/${step.challengeId}/poll`, { body: { pollSecret: step.pollSecret }, auth: false });
        if (res.status === 'signed_in' && res.tokens) await accept(res.tokens);
        if (res.status === 'rejected') {
          setError('The sign-in was declined on your other device.');
          setStep({ kind: 'email' });
        }
        if (res.status === 'expired') {
          setError('That code expired. Request a new one.');
          setStep({ kind: 'email' });
        }
      } catch {
        /* keep polling */
      }
    }, 2500);
    return () => clearInterval(t);
  }, [step, accept]);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ challengeId: string; pollSecret: string }>('/auth/email/start', { body: { email, device: deviceInfo() }, auth: false });
      setStep({ kind: 'code', email: email.toLowerCase(), ...res });
      setTimeout(() => codeRef.current?.focus(), 50);
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'rate_limited' ? 'Too many attempts — wait a few minutes and try again.' : 'Couldn’t send a code. Check the address and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function verify(e?: React.FormEvent) {
    e?.preventDefault();
    if (step.kind !== 'code' || code.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ status: string; tokens?: AuthTokensDTO }>('/auth/email/verify', { body: { challengeId: step.challengeId, code, pollSecret: step.pollSecret }, auth: false });
      if (res.status === 'awaiting_approval') setStep({ ...step, kind: 'approval' });
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

  if (step.kind === 'approval') {
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

  if (step.kind === 'code') {
    return (
      <AuthFrame title="Check your email" subtitle={`We sent a 6-digit code to ${step.email}. You can also tap the link in that email on any device.`}>
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
              aria-describedby={error ? 'login-error' : undefined}
            />
          </Field>
          {error && (
            <p id="login-error" role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy || code.length !== 6}>
            {busy ? <Spinner className="text-[#06122e]" /> : 'Sign in'}
          </Button>
          <button type="button" className="w-full text-center text-sm text-ink-muted hover:text-ink" onClick={() => setStep({ kind: 'email' })}>
            Use a different email
          </button>
          <p className="text-center text-xs text-ink-faint">Codes expire in 10 minutes and work once.</p>
        </form>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame title="Welcome to your observatory" subtitle="Sign in or create an account — no password needed.">
      <form onSubmit={start} className="space-y-4">
        <Field label="Email" htmlFor="email">
          <Input id="email" type="email" required autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy || !email}>
          {busy ? <Spinner className="text-[#06122e]" /> : (<><Mail size={16} /> Email me a sign-in code</>)}
        </Button>
      </form>
      {providers.length > 0 && (
        <div className="mt-6 space-y-2">
          <div className="flex items-center gap-3 text-xs uppercase tracking-wider text-ink-faint">
            <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
          </div>
          {providers.map((p) => {
            const d = deviceInfo();
            const href = `${API_URL}/auth/oauth/${p}/start?platform=${d.platform}&deviceName=${encodeURIComponent(d.name)}&native=${isTauri() ? 1 : 0}`;
            return (
              <a key={p} href={href} className="glass flex h-11 w-full items-center justify-center rounded-xl text-sm font-medium hover:border-line-strong">
                {OAUTH_LABELS[p] ?? p}
              </a>
            );
          })}
        </div>
      )}
      <p className="mt-6 text-center text-xs text-ink-faint">Already signed in on your phone? You can also link this device from <em>Settings → Linked devices</em> there.</p>
    </AuthFrame>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}
