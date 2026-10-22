import type { AuthTokensDTO } from '@remindora/types';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Pressable, Text, TextInput, View } from 'react-native';
import { Button, Glass, Screen, styles } from '../src/components/ui';
import { api, ApiError } from '../src/lib/api';
import { deviceInfo, useSession } from '../src/lib/session';
import { colors } from '../src/lib/theme';

export default function Login() {
  const accept = useSession((s) => s.accept);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<{ kind: 'email' } | { kind: 'code' | 'approval'; challengeId: string; pollSecret: string }>({ kind: 'email' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const codeRef = useRef<React.ComponentRef<typeof TextInput>>(null);

  useEffect(() => {
    if (step.kind === 'email') return;
    const t = setInterval(async () => {
      const r = await api<{ status: string; tokens?: AuthTokensDTO }>(`/auth/email/challenges/${step.challengeId}/poll`, { body: { pollSecret: step.pollSecret }, auth: false }).catch(() => null);
      if (r?.status === 'signed_in' && r.tokens) await accept(r.tokens);
      if (r?.status === 'rejected' || r?.status === 'expired') {
        setError(r.status === 'rejected' ? 'The sign-in was declined on your other device.' : 'That code expired.');
        setStep({ kind: 'email' });
      }
    }, 2500);
    return () => clearInterval(t);
  }, [step, accept]);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ challengeId: string; pollSecret: string }>('/auth/email/start', { body: { email: email.trim(), device: deviceInfo() }, auth: false });
      setStep({ kind: 'code', ...r });
      setTimeout(() => codeRef.current?.focus(), 100);
    } catch (e) {
      setError(e instanceof ApiError && e.isNetwork ? 'Can’t reach Remindora. Check your connection.' : 'Couldn’t send a code. Check the address.');
    } finally {
      setBusy(false);
    }
  }

  async function verify(value: string) {
    if (step.kind !== 'code' || value.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ status: string; tokens?: AuthTokensDTO }>('/auth/email/verify', { body: { challengeId: step.challengeId, code: value, pollSecret: step.pollSecret }, auth: false });
      if (r.status === 'awaiting_approval') setStep({ ...step, kind: 'approval' });
      else if (r.tokens) await accept(r.tokens);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'That code didn’t work.');
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1, justifyContent: 'center', padding: 20 }}>
        <View style={{ alignItems: 'center', marginBottom: 28 }}>
          <Image source={require('../assets/images/icon.png')} style={{ width: 84, height: 84, borderRadius: 20 }} accessibilityIgnoresInvertColors accessible={false} />
          <Text style={{ color: colors.text, fontSize: 28, fontWeight: '700', marginTop: 14 }}>Remindora</Text>
          <Text style={{ color: colors.textMuted, marginTop: 4 }}>Capture, plan and focus — everywhere.</Text>
        </View>
        <Glass>
          {step.kind === 'email' && (
            <View style={{ gap: 12 }}>
              <TextInput style={styles.input} value={email} onChangeText={setEmail} placeholder="you@example.com" placeholderTextColor={colors.textFaint} keyboardType="email-address" autoCapitalize="none" autoComplete="email" accessibilityLabel="Email" />
              <Button label="Email me a sign-in code" variant="primary" onPress={start} busy={busy} disabled={!email.includes('@')} />
              <Button label="Scan QR from my computer" onPress={() => router.push('/link')} />
            </View>
          )}
          {step.kind === 'code' && (
            <View style={{ gap: 12 }}>
              <Text style={{ color: colors.textMuted }}>Enter the 6-digit code we emailed you — or tap the link in that email.</Text>
              <TextInput
                ref={codeRef}
                style={[styles.input, { fontSize: 26, letterSpacing: 10, textAlign: 'center' }]}
                value={code}
                onChangeText={(v) => {
                  const digits = v.replace(/\D/g, '').slice(0, 6);
                  setCode(digits);
                  if (digits.length === 6) void verify(digits);
                }}
                keyboardType="number-pad"
                autoComplete="one-time-code"
                textContentType="oneTimeCode"
                accessibilityLabel="Verification code"
              />
              {busy ? <ActivityIndicator color={colors.cyan} /> : null}
              <Button label="Use a different email" variant="ghost" onPress={() => setStep({ kind: 'email' })} />
            </View>
          )}
          {step.kind === 'approval' && (
            <View style={{ gap: 10 }}>
              <Text style={{ color: colors.text, fontSize: 17, fontWeight: '600' }}>Approve on your other device</Text>
              <Text style={{ color: colors.textMuted }}>For your security, open Remindora on a device that’s already signed in and tap Approve.</Text>
              <ActivityIndicator color={colors.cyan} style={{ marginTop: 8 }} />
            </View>
          )}
          {error ? <Text accessibilityRole="alert" style={{ color: colors.danger, marginTop: 12 }}>{error}</Text> : null}
        </Glass>
        <Pressable onPress={() => router.push('/about')} accessibilityRole="link" style={{ alignSelf: 'center', marginTop: 16 }}>
          <Text style={{ color: colors.textMuted }}>About Remindora</Text>
        </Pressable>
      </KeyboardAvoidingView>
    </Screen>
  );
}
