'use client';
import { Button, Field, Input, Spinner } from '@remindora/ui';
import { MailCheck, Send } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { AuthFrame } from '@/components/auth-frame';
import { api, ApiError } from '@/lib/api';

function ForgotInner() {
  const params = useSearchParams();
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/auth/password/forgot', { body: { email }, auth: false });
      setSentTo(email.toLowerCase());
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'rate_limited' ? 'Too many requests — wait a few minutes and try again.' : 'Couldn’t send the email. Check the address and try again.');
    } finally {
      setBusy(false);
    }
  }

  if (sentTo) {
    return (
      <AuthFrame title="Check your inbox" subtitle="If an account exists for that email, a reset link is on its way.">
        <div className="flex items-start gap-3 rounded-2xl border border-line bg-bg-elevated/60 p-4 text-sm text-ink-muted">
          <MailCheck className="mt-0.5 shrink-0 text-cyan" size={20} />
          <p>
            We sent instructions to <strong className="text-ink">{sentTo}</strong>. The link expires in 30 minutes. Don’t see it? Check your spam folder.
          </p>
        </div>
        <Button variant="secondary" size="lg" className="mt-5 w-full" onClick={() => setSentTo(null)}>
          Try a different email
        </Button>
        <p className="mt-5 text-center text-sm">
          <Link href="/login" className="font-medium text-cyan hover:underline">
            Back to sign in
          </Link>
        </p>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame title="Forgot your password?" subtitle="Enter your account email and we’ll send you a link to choose a new one.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email" htmlFor="email">
          <Input id="email" type="email" required autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy || !email}>
          {busy ? <Spinner className="text-on-accent" /> : (<><Send size={16} /> Send reset link</>)}
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-ink-muted">
        Remembered it?{' '}
        <Link href="/login" className="font-medium text-cyan hover:underline">
          Sign in
        </Link>
      </p>
    </AuthFrame>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense>
      <ForgotInner />
    </Suspense>
  );
}
