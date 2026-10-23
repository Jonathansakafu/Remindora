'use client';
import { Button, Field, Input, Spinner } from '@remindora/ui';
import { UserPlus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { AuthFrame } from '@/components/auth-frame';
import { CodeStep, type Challenge } from '@/components/auth/code-step';
import { passwordChecks, PasswordInput, PasswordStrength } from '@/components/auth/password-input';
import { api, ApiError } from '@/lib/api';
import { deviceInfo } from '@/lib/platform';
import { useSession } from '@/lib/session';

export default function RegisterPage() {
  const router = useRouter();
  const status = useSession((s) => s.status);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; exists?: boolean } | null>(null);
  const [challenge, setChallenge] = useState<Challenge | null>(null);

  useEffect(() => {
    if (status === 'signed_in') router.replace('/app/today');
  }, [status, router]);

  const back = useCallback((msg?: string) => {
    setChallenge(null);
    if (msg) setError({ message: msg });
  }, []);

  const strongEnough = passwordChecks(password, email).every((c) => c.ok);
  const mismatch = confirm.length > 0 && confirm !== password;
  const canSubmit = name.trim() && email && strongEnough && confirm === password && agreed && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ challengeId: string; pollSecret: string }>('/auth/register', { body: { name: name.trim(), email, password, device: deviceInfo() }, auth: false });
      setChallenge({ email: email.toLowerCase(), ...res });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'account_exists') setError({ message: 'An account with this email already exists.', exists: true });
      else if (err instanceof ApiError && err.code === 'rate_limited') setError({ message: 'Too many attempts — wait a few minutes and try again.' });
      else setError({ message: err instanceof ApiError ? err.message : 'Couldn’t create your account. Check your connection and try again.' });
    } finally {
      setBusy(false);
    }
  }

  if (challenge) {
    return (
      <CodeStep
        challenge={challenge}
        title="Confirm your email"
        subtitle={`We sent a 6-digit code to ${challenge.email}. Enter it to finish creating your account.`}
        submitLabel="Create account"
        backLabel="Change details"
        onBack={back}
      />
    );
  }

  return (
    <AuthFrame title="Create your account" subtitle="Free forever for personal use. Takes less than a minute.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Full name" htmlFor="name">
          <Input id="name" required autoComplete="name" placeholder="Jane Doe" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </Field>
        <Field label="Email" htmlFor="email">
          <Input id="email" type="email" required autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <div>
          <Field label="Password" htmlFor="password">
            <PasswordInput id="password" required autoComplete="new-password" placeholder="Create a password" value={password} onChange={(e) => setPassword(e.target.value)} aria-describedby="password-rules" maxLength={128} />
          </Field>
          <div id="password-rules">
            <PasswordStrength password={password} email={email} />
          </div>
        </div>
        <Field label="Confirm password" htmlFor="confirm">
          <PasswordInput id="confirm" required autoComplete="new-password" placeholder="Type it again" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={mismatch} aria-describedby={mismatch ? 'confirm-error' : undefined} />
        </Field>
        {mismatch && (
          <p id="confirm-error" className="-mt-2 text-xs text-danger">
            Passwords don’t match
          </p>
        )}
        <label className="flex items-start gap-2.5 text-sm text-ink-muted">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-[#60E9FF]" />
          <span>I agree to use Remindora responsibly and to receive account emails (sign-in codes, security alerts and reminders I turn on).</span>
        </label>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error.message}{' '}
            {error.exists && (
              <>
                <Link href={`/login?email=${encodeURIComponent(email)}`} className="font-medium underline">
                  Sign in
                </Link>{' '}
                or{' '}
                <Link href={`/forgot-password?email=${encodeURIComponent(email)}`} className="font-medium underline">
                  reset your password
                </Link>
                .
              </>
            )}
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={!canSubmit}>
          {busy ? <Spinner className="text-on-accent" /> : (<><UserPlus size={16} /> Create account</>)}
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-ink-muted">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-cyan hover:underline">
          Sign in
        </Link>
      </p>
    </AuthFrame>
  );
}
