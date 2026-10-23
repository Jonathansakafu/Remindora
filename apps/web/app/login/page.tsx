'use client';
import { Button, Field, Input, Label, Spinner } from '@remindora/ui';
import type { AuthTokensDTO } from '@remindora/types';
import { LogIn, Mail } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { AuthFrame } from '@/components/auth-frame';
import { CodeStep, type Challenge } from '@/components/auth/code-step';
import { PasswordInput } from '@/components/auth/password-input';
import { api, ApiError } from '@/lib/api';
import { API_URL } from '@/lib/config';
import { deviceInfo, isTauri } from '@/lib/platform';
import { useSession } from '@/lib/session';

const OAUTH_LABELS: Record<string, string> = { google: 'Continue with Google', github: 'Continue with GitHub', microsoft: 'Continue with Microsoft' };

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const status = useSession((s) => s.status);
  const accept = useSession((s) => s.accept);
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [busy, setBusy] = useState<'password' | 'code' | null>(null);
  const [error, setError] = useState<string | null>(params.get('error') ? 'Sign-in with that provider didn’t complete. Try again or use email.' : null);
  const [notice] = useState<string | null>(params.get('reset') === '1' ? 'Your password was changed. Sign in with your new password.' : null);
  const [providers, setProviders] = useState<string[]>([]);

  useEffect(() => {
    if (status === 'signed_in') router.replace('/app/today');
  }, [status, router]);
  useEffect(() => {
    api<{ oauth: string[] }>('/auth/providers', { auth: false }).then((p) => setProviders(p.oauth)).catch(() => undefined);
  }, []);

  const back = useCallback((msg?: string) => {
    setChallenge(null);
    if (msg) setError(msg);
  }, []);

  async function signInWithPassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy('password');
    setError(null);
    try {
      const res = await api<{ tokens: AuthTokensDTO }>('/auth/password/login', { body: { email, password, device: deviceInfo() }, auth: false });
      await accept(res.tokens);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'invalid_credentials') setError('Email or password is incorrect. If you usually sign in with an email code, use that below or reset your password to set one.');
      else if (err instanceof ApiError && err.code === 'rate_limited') setError('Too many attempts — wait a few minutes and try again.');
      else setError(err instanceof ApiError ? err.message : 'Couldn’t sign in. Check your connection and try again.');
    } finally {
      setBusy(null);
    }
  }

  async function sendCode() {
    if (!email) {
      setError('Enter your email first, then we’ll send you a code.');
      return;
    }
    setBusy('code');
    setError(null);
    try {
      const res = await api<{ challengeId: string; pollSecret: string }>('/auth/email/start', { body: { email, device: deviceInfo() }, auth: false });
      setChallenge({ email: email.toLowerCase(), ...res });
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'rate_limited' ? 'Too many attempts — wait a few minutes and try again.' : 'Couldn’t send a code. Check the address and try again.');
    } finally {
      setBusy(null);
    }
  }

  if (challenge) {
    return (
      <CodeStep
        challenge={challenge}
        title="Check your email"
        subtitle={`We sent a 6-digit code to ${challenge.email}. You can also tap the link in that email on any device.`}
        submitLabel="Sign in"
        backLabel="Back to sign in"
        onBack={back}
      />
    );
  }

  return (
    <AuthFrame title="Welcome back" subtitle="Sign in to continue to your tasks, calendar and reminders.">
      {notice && (
        <p role="status" className="mb-4 rounded-xl border border-success/30 bg-success/10 px-3 py-2.5 text-sm text-success">
          {notice}
        </p>
      )}
      <form onSubmit={signInWithPassword} className="space-y-4" noValidate>
        <Field label="Email" htmlFor="email">
          <Input id="email" type="email" required autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <Label htmlFor="password" className="mb-0">
              Password
            </Label>
            <Link href={`/forgot-password${email ? `?email=${encodeURIComponent(email)}` : ''}`} className="text-xs font-medium text-cyan hover:underline">
              Forgot password?
            </Link>
          </div>
          <PasswordInput id="password" required autoComplete="current-password" placeholder="Your password" value={password} onChange={(e) => setPassword(e.target.value)} aria-describedby={error ? 'login-error' : undefined} />
        </div>
        {error && (
          <p id="login-error" role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy !== null || !email || !password}>
          {busy === 'password' ? <Spinner className="text-on-accent" /> : (<><LogIn size={16} /> Sign in</>)}
        </Button>
      </form>

      <div className="my-5 flex items-center gap-3 text-xs uppercase tracking-wider text-ink-faint">
        <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
      </div>

      <div className="space-y-2">
        <Button variant="secondary" size="lg" className="w-full" onClick={sendCode} disabled={busy !== null}>
          {busy === 'code' ? <Spinner /> : (<><Mail size={16} /> Email me a sign-in code</>)}
        </Button>
        {providers.map((p) => {
          const d = deviceInfo();
          const href = `${API_URL}/auth/oauth/${p}/start?platform=${d.platform}&deviceName=${encodeURIComponent(d.name)}&native=${isTauri() ? 1 : 0}`;
          return (
            <a key={p} href={href} className="glass flex h-12 w-full items-center justify-center rounded-xl text-sm font-medium hover:border-line-strong">
              {OAUTH_LABELS[p] ?? p}
            </a>
          );
        })}
      </div>

      <p className="mt-6 text-center text-sm text-ink-muted">
        New to Remindora?{' '}
        <Link href="/register" className="font-medium text-cyan hover:underline">
          Create an account
        </Link>
      </p>
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
