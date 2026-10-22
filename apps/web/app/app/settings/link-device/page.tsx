'use client';
import { Button, Input, ProgressRing, Spinner } from '@remindora/ui';
import type { PairingCreatedDTO } from '@remindora/types';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ShieldCheck, Smartphone } from 'lucide-react';
import Link from 'next/link';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useState } from 'react';
import { Section } from '@/components/settings/section';
import { api, ApiError } from '@/lib/api';
import { keys, reportError } from '@/lib/queries';
import { onRealtime } from '@/lib/realtime';

type State =
  | { step: 'idle' }
  | { step: 'reauth'; challengeId: string | null }
  | { step: 'qr'; pairing: PairingCreatedDTO }
  | { step: 'claimed'; pairing: PairingCreatedDTO; deviceName: string; platform: string; code: string }
  | { step: 'done'; deviceName: string }
  | { step: 'expired' };

/**
 * QR device linking (initiator side). Generating a code requires re-authentication;
 * the QR holds a single-use encrypted token valid for 60 seconds and no account data.
 */
export default function LinkDevicePage() {
  const [state, setState] = useState<State>({ step: 'idle' });
  const [code, setCode] = useState('');
  const [now, setNow] = useState(Date.now());
  const qc = useQueryClient();

  async function generate() {
    try {
      const pairing = await api<PairingCreatedDTO>('/pairing', { method: 'POST' });
      setState({ step: 'qr', pairing });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'reauth_required') setState({ step: 'reauth', challengeId: null });
      else reportError(e);
    }
  }

  async function startReauth() {
    try {
      const r = await api<{ challengeId: string }>('/auth/reauth/start', { method: 'POST' });
      setState({ step: 'reauth', challengeId: r.challengeId });
    } catch (e) {
      reportError(e);
    }
  }

  async function verifyReauth() {
    if (state.step !== 'reauth' || !state.challengeId) return;
    try {
      await api('/auth/reauth/verify', { body: { challengeId: state.challengeId, code } });
      setCode('');
      await generate();
    } catch (e) {
      reportError(e);
    }
  }

  // Countdown + status polling fallback while a QR/claim is live.
  useEffect(() => {
    if (state.step !== 'qr' && state.step !== 'claimed') return;
    const t = setInterval(async () => {
      setNow(Date.now());
      if (state.step === 'qr' && new Date(state.pairing.expiresAt).getTime() <= Date.now()) return setState({ step: 'expired' });
      try {
        const s = await api<{ status: string; claimant: { name: string; platform: string; verificationCode: string } | null }>(`/pairing/${state.pairing.pairingId}`);
        if (s.status === 'CLAIMED' && state.step === 'qr' && s.claimant) setState({ step: 'claimed', pairing: state.pairing, deviceName: s.claimant.name, platform: s.claimant.platform, code: s.claimant.verificationCode });
        if (s.status === 'CONSUMED') setState({ step: 'done', deviceName: state.step === 'claimed' ? state.deviceName : 'New device' });
        if (s.status === 'EXPIRED' || s.status === 'REJECTED') setState({ step: 'expired' });
      } catch {
        /* keep polling */
      }
    }, 1000);
    return () => clearInterval(t);
  }, [state]);

  useEffect(() => {
    const onClaim = (p: { pairingId: string; deviceName: string; platform: string; verificationCode: string }) =>
      setState((cur) => (cur.step === 'qr' && cur.pairing.pairingId === p.pairingId ? { step: 'claimed', pairing: cur.pairing, deviceName: p.deviceName, platform: p.platform, code: p.verificationCode } : cur));
    const onDone = () => {
      setState((cur) => ({ step: 'done', deviceName: cur.step === 'claimed' ? cur.deviceName : 'New device' }));
      qc.invalidateQueries({ queryKey: keys.devices });
    };
    const offClaim = onRealtime('pairing.claimed', onClaim);
    const offDone = onRealtime('pairing.completed', onDone);
    return () => {
      offClaim();
      offDone();
    };
  }, [qc]);

  async function decide(approve: boolean) {
    if (state.step !== 'claimed') return;
    try {
      await api(`/pairing/${state.pairing.pairingId}/decision`, { body: { approve } });
      if (!approve) setState({ step: 'idle' });
    } catch (e) {
      reportError(e);
    }
  }

  return (
    <Section title="Link a new device" description="Open Remindora on your Android phone, tap “Scan to link”, and point the camera at this code.">
      {state.step === 'idle' && (
        <div className="flex flex-col items-start gap-3">
          <ul className="space-y-1.5 text-sm text-ink-muted">
            <li className="flex items-center gap-2"><ShieldCheck size={15} className="text-cyan" /> You’ll confirm it’s you first.</li>
            <li className="flex items-center gap-2"><ShieldCheck size={15} className="text-cyan" /> The code works once and expires in 60 seconds.</li>
            <li className="flex items-center gap-2"><ShieldCheck size={15} className="text-cyan" /> You’ll approve the device here before it gets access.</li>
          </ul>
          <Button variant="primary" onClick={generate}><Smartphone size={15} /> Show linking code</Button>
        </div>
      )}
      {state.step === 'reauth' && (
        <div className="max-w-sm space-y-3">
          <p className="text-sm text-ink-muted">For your security, confirm it’s you before linking a device.</p>
          {!state.challengeId ? (
            <Button variant="primary" onClick={startReauth}>Email me a confirmation code</Button>
          ) : (
            <form className="flex gap-2" onSubmit={(e) => (e.preventDefault(), verifyReauth())}>
              <Input aria-label="Confirmation code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} className="w-40 text-center tracking-[0.3em]" autoFocus />
              <Button type="submit" variant="primary" disabled={code.length !== 6}>Confirm</Button>
            </form>
          )}
        </div>
      )}
      {state.step === 'qr' && (
        <div className="flex flex-wrap items-center gap-8">
          <div className="rounded-2xl bg-white p-4" role="img" aria-label="Device linking QR code">
            <QRCodeSVG value={state.pairing.deepLink} size={208} level="M" />
          </div>
          <div className="space-y-3">
            <ProgressRing value={Math.max(0, new Date(state.pairing.expiresAt).getTime() - now) / 60_000} size={64} color="#60E9FF" label={`${Math.max(0, Math.ceil((new Date(state.pairing.expiresAt).getTime() - now) / 1000))}s`} />
            <p className="flex items-center gap-2 text-sm text-ink-muted"><Spinner size={14} /> Waiting for your phone to scan…</p>
          </div>
        </div>
      )}
      {state.step === 'claimed' && (
        <div className="max-w-md space-y-4" role="alertdialog" aria-labelledby="claim-title">
          <p id="claim-title" className="text-sm text-ink">
            <strong>{state.deviceName}</strong> ({state.platform.toLowerCase()}) wants to link to your account.
          </p>
          <div>
            <p className="text-xs text-ink-faint">Check that your phone shows the same code:</p>
            <p className="mt-1 font-display text-4xl font-semibold tracking-[0.35em] text-cyan">{state.code}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => decide(true)}>Codes match — approve</Button>
            <Button variant="ghost" onClick={() => decide(false)}>Reject</Button>
          </div>
        </div>
      )}
      {state.step === 'done' && (
        <div className="flex items-center gap-3">
          <CheckCircle2 className="text-success" size={28} />
          <p className="text-sm"><strong>{state.deviceName}</strong> is linked. <Link href="/app/settings/devices" className="text-cyan hover:underline">See all devices</Link></p>
        </div>
      )}
      {state.step === 'expired' && (
        <div className="space-y-3">
          <p className="text-sm text-ink-muted">That code expired or was cancelled.</p>
          <Button variant="primary" onClick={generate}>Show a new code</Button>
        </div>
      )}
    </Section>
  );
}
