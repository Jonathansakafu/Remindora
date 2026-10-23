'use client';
import { cn, Input } from '@remindora/ui';
import { Eye, EyeOff } from 'lucide-react';
import { forwardRef, useState, type InputHTMLAttributes } from 'react';

export const PasswordInput = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>>(({ className, ...props }, ref) => {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input ref={ref} type={show ? 'text' : 'password'} className={cn('pr-11', className)} {...props} />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? 'Hide password' : 'Show password'}
        aria-pressed={show}
        className="absolute inset-y-0 right-0 grid w-11 place-items-center text-ink-faint hover:text-ink"
      >
        {show ? <EyeOff size={17} /> : <Eye size={17} />}
      </button>
    </div>
  );
});
PasswordInput.displayName = 'PasswordInput';

/** Mirrors the server's rules (packages/auth password.ts); the server stays authoritative. */
export function passwordChecks(password: string, email = '') {
  const local = email.split('@')[0]?.toLowerCase() ?? '';
  return [
    { ok: password.length >= 8, label: 'At least 8 characters' },
    { ok: /[a-zA-Z]/.test(password) && /[0-9\W_]/.test(password), label: 'Letters plus a number or symbol' },
    { ok: password.length > 0 && (!local || local.length < 3 || !password.toLowerCase().includes(local)), label: 'Doesn’t contain your email name' },
  ];
}

export function passwordScore(password: string, email = '') {
  if (!password) return 0;
  const base = passwordChecks(password, email).filter((c) => c.ok).length;
  const bonus = (password.length >= 12 ? 1 : 0) + (/[A-Z]/.test(password) && /[a-z]/.test(password) && /\W/.test(password) ? 1 : 0);
  return Math.min(4, Math.max(1, base - 1 + bonus));
}

const LEVELS = [
  { label: '', color: '' },
  { label: 'Weak', color: 'bg-danger' },
  { label: 'Fair', color: 'bg-amber' },
  { label: 'Good', color: 'bg-cyan' },
  { label: 'Strong', color: 'bg-success' },
];

export function PasswordStrength({ password, email }: { password: string; email?: string }) {
  const score = passwordScore(password, email);
  const checks = passwordChecks(password, email);
  return (
    <div className="mt-2" aria-live="polite">
      <div className="flex gap-1" aria-hidden>
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className={cn('h-1 flex-1 rounded-full', i <= score ? LEVELS[score]!.color : 'bg-white/10')} />
        ))}
      </div>
      {password && <p className="mt-1.5 text-xs text-ink-muted">Strength: {LEVELS[score]!.label}</p>}
      <ul className="mt-2 space-y-1">
        {checks.map((c) => (
          <li key={c.label} className={cn('flex items-center gap-2 text-xs', c.ok ? 'text-success' : 'text-ink-faint')}>
            <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', c.ok ? 'bg-success' : 'bg-ink-faint')} />
            {c.label}
            <span className="sr-only">{c.ok ? '(done)' : '(not yet)'}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
