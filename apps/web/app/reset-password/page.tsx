'use client';
import { Button, Field, Spinner } from '@remindora/ui';
import { KeyRound } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { AuthFrame } from '@/components/auth-frame';
import { passwordChecks, PasswordInput, PasswordStrength } from '@/components/auth/password-input';
import { api, ApiError } from '@/lib/api';

function ResetInner() {
  const router = useRouter();
  const params = useSearchParams();
  const challengeId = params.get('c') ?? '';
  const token = params.get('t') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; expired?: boolean } | null>(null);

  if (!challengeId || !token) {
    return (
      <AuthFrame title="This link is incomplete" subtitle="Open the reset link from your email again, or request a new one.">
        <Link href="/forgot-password" className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-cyan font-semibold text-on-accent">
          Request a new link
        </Link>
      </AuthFrame>
    );
  }

  const strongEnough = passwordChecks(password).every((c) => c.ok);
  const mismatch = confirm.length > 0 && confirm !== password;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!strongEnough || password !== confirm) return;
    setBusy(true);
    setError(null);
    try {
      await api('/auth/password/reset', { body: { challengeId, token, password }, auth: false });
      router.replace('/login?reset=1');
    } catch (err) {
      const expired = err instanceof ApiError && ['challenge_used', 'challenge_expired', 'invalid_link'].includes(err.code);
      setError({ message: err instanceof ApiError ? err.message : 'Couldn’t change your password. Try again.', expired });
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthFrame title="Choose a new password" subtitle="After saving, every device signs out and you sign in again with the new password.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div>
          <Field label="New password" htmlFor="password">
            <PasswordInput id="password" required autoComplete="new-password" placeholder="Create a password" value={password} onChange={(e) => setPassword(e.target.value)} aria-describedby="password-rules" maxLength={128} autoFocus />
          </Field>
          <div id="password-rules">
            <PasswordStrength password={password} />
          </div>
        </div>
        <Field label="Confirm new password" htmlFor="confirm">
          <PasswordInput id="confirm" required autoComplete="new-password" placeholder="Type it again" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={mismatch} aria-describedby={mismatch ? 'confirm-error' : undefined} />
        </Field>
        {mismatch && (
          <p id="confirm-error" className="-mt-2 text-xs text-danger">
            Passwords don’t match
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error.message}{' '}
            {error.expired && (
              <Link href="/forgot-password" className="font-medium underline">
                Request a new link
              </Link>
            )}
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy || !strongEnough || password !== confirm}>
          {busy ? <Spinner className="text-on-accent" /> : (<><KeyRound size={16} /> Save new password</>)}
        </Button>
      </form>
    </AuthFrame>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetInner />
    </Suspense>
  );
}
