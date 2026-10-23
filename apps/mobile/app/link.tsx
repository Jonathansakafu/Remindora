import type { AuthTokensDTO, PairingClaimDTO } from '@remindora/types';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { Button, Glass, Screen } from '../src/components/ui';
import { api, ApiError } from '../src/lib/api';
import { authenticate } from '../src/lib/biometric';
import { deviceInfo, useSession } from '../src/lib/session';
import { colors } from '../src/lib/theme';

type State = { step: 'scan' } | { step: 'confirm'; token: string } | { step: 'waiting'; claim: PairingClaimDTO } | { step: 'error'; message: string };

/**
 * QR device linking (claimant side): scan → biometric confirmation → claim → show the
 * matching code → wait for approval on the other device → receive our own session.
 * Also opened directly by the system camera via remindora://link?t=…
 */
export default function Link() {
  const params = useLocalSearchParams<{ t?: string }>();
  const status = useSession((s) => s.status);
  const accept = useSession((s) => s.accept);
  const [permission, requestPermission] = useCameraPermissions();
  const [state, setState] = useState<State>(params.t ? { step: 'confirm', token: params.t } : { step: 'scan' });
  const scanned = useRef(false);

  useEffect(() => {
    if (state.step !== 'waiting') return;
    const t = setInterval(async () => {
      try {
        const s = await api<{ status: string }>(`/pairing/claim/${state.claim.claimId}/status`, { auth: false, headers: { 'x-claim-secret': state.claim.claimSecret } });
        if (s.status === 'APPROVED') {
          clearInterval(t);
          const tokens = await api<AuthTokensDTO>(`/pairing/claim/${state.claim.claimId}/complete`, { body: { claimSecret: state.claim.claimSecret }, auth: false });
          await accept(tokens);
          router.replace('/reminders');
        }
        if (s.status === 'REJECTED' || s.status === 'EXPIRED') {
          clearInterval(t);
          setState({ step: 'error', message: s.status === 'REJECTED' ? 'The request was declined on your other device.' : 'The link expired. Generate a new QR code.' });
        }
      } catch {
        /* keep polling */
      }
    }, 1500);
    return () => clearInterval(t);
  }, [state, accept]);

  async function claim(token: string) {
    // Explicit confirmation on this device: biometric (or device credential) before anything is sent.
    if (!(await authenticate('Confirm linking this phone'))) return;
    try {
      const claim = await api<PairingClaimDTO>('/pairing/claim', { body: { token, device: deviceInfo() }, auth: false });
      setState({ step: 'waiting', claim });
    } catch (e) {
      setState({ step: 'error', message: e instanceof ApiError ? e.message : 'This code didn’t work.' });
    }
  }

  if (status === 'signed_in') {
    return (
      <Screen title="Link a device">
        <View style={{ padding: 20 }}>
          <Glass>
            <Text style={{ color: colors.text }}>This phone is already signed in. To link a computer, open Remindora there and sign in with your email, or use “Link a new device” in its settings and scan with a phone that’s signed out.</Text>
            <View style={{ marginTop: 12 }}><Button label="Close" onPress={() => router.back()} /></View>
          </Glass>
        </View>
      </Screen>
    );
  }

  return (
    <Screen title="Link this phone" subtitle="Scan the code shown in Remindora on your computer">
      <View style={{ padding: 20, flex: 1 }}>
        {state.step === 'scan' &&
          (!permission?.granted ? (
            <Glass>
              <Text style={{ color: colors.text, marginBottom: 12 }}>Remindora needs the camera to scan the linking code. Nothing is recorded.</Text>
              <Button label="Allow camera" variant="primary" onPress={requestPermission} />
            </Glass>
          ) : (
            <View style={{ flex: 1, borderRadius: 24, overflow: 'hidden', borderWidth: 1, borderColor: colors.border }}>
              <CameraView
                style={{ flex: 1 }}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={({ data }) => {
                  if (scanned.current) return;
                  const m = /^remindora:\/\/link\?t=(.+)$/.exec(data);
                  if (!m) return;
                  scanned.current = true;
                  setState({ step: 'confirm', token: decodeURIComponent(m[1]!) });
                }}
                accessibilityLabel="QR code scanner"
              />
            </View>
          ))}
        {state.step === 'confirm' && (
          <Glass>
            <Text style={{ color: colors.text, fontSize: 17, fontWeight: '600' }}>Link this phone to your account?</Text>
            <Text style={{ color: colors.textMuted, marginTop: 6 }}>You’ll confirm with your fingerprint or face, then approve on your computer.</Text>
            <View style={{ gap: 8, marginTop: 14 }}>
              <Button label="Confirm and link" variant="primary" onPress={() => claim(state.token)} />
              <Button label="Cancel" variant="ghost" onPress={() => router.back()} />
            </View>
          </Glass>
        )}
        {state.step === 'waiting' && (
          <Glass style={{ alignItems: 'center' }}>
            <Text style={{ color: colors.textMuted }}>Check that {state.claim.initiatorDeviceName} shows</Text>
            <Text style={{ color: colors.cyan, fontSize: 44, fontWeight: '700', letterSpacing: 12, marginVertical: 12 }} accessibilityLabel={`Code ${state.claim.verificationCode.split('').join(' ')}`}>{state.claim.verificationCode}</Text>
            <Text style={{ color: colors.textMuted, textAlign: 'center' }}>Then tap Approve there.</Text>
            <ActivityIndicator color={colors.cyan} style={{ marginTop: 14 }} />
          </Glass>
        )}
        {state.step === 'error' && (
          <Glass>
            <Text style={{ color: colors.danger }}>{state.message}</Text>
            <View style={{ marginTop: 12 }}><Button label="Scan again" onPress={() => { scanned.current = false; setState({ step: 'scan' }); }} /></View>
          </Glass>
        )}
      </View>
    </Screen>
  );
}
