import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';
import { api } from './api';

const LOCK_PREF = 'remindora.appLock';
const BIO_SECRET = 'remindora.bioSecret';

export const useLock = create<{ enabled: boolean; locked: boolean; lastActive: number }>(() => ({ enabled: false, locked: false, lastActive: Date.now() }));

export async function loadLockPreference() {
  const enabled = (await AsyncStorage.getItem(LOCK_PREF)) === '1';
  useLock.setState({ enabled, locked: enabled });
}

export async function setAppLock(enabled: boolean) {
  if (enabled) {
    const ok = await authenticate('Turn on biometric lock');
    if (!ok) return false;
  }
  await AsyncStorage.setItem(LOCK_PREF, enabled ? '1' : '0');
  useLock.setState({ enabled, locked: false });
  return true;
}

export async function biometricsAvailable() {
  return (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
}

export async function authenticate(prompt: string): Promise<boolean> {
  if (!(await biometricsAvailable())) return true; // No biometrics enrolled: fall back to device trust.
  const r = await LocalAuthentication.authenticateAsync({ promptMessage: prompt, cancelLabel: 'Cancel', disableDeviceFallback: false });
  return r.success;
}

/**
 * Biometric-backed re-authentication. A per-device secret is kept in SecureStore with
 * `requireAuthentication`, so reading it triggers the OS biometric prompt; we prove
 * possession by returning HMAC-SHA256(secret, serverNonce). Enrolment needs a fresh login.
 */
export async function enrollBiometricReauth() {
  if (!(await biometricsAvailable())) return false;
  const { secret } = await api<{ secret: string }>('/auth/reauth/biometric/enroll', { method: 'POST' });
  await SecureStore.setItemAsync(BIO_SECRET, secret, { requireAuthentication: true, authenticationPrompt: 'Confirm to enable biometric security' });
  return true;
}

export async function biometricReauth(): Promise<boolean> {
  const secret = await SecureStore.getItemAsync(BIO_SECRET, { requireAuthentication: true, authenticationPrompt: 'Confirm it’s you' }).catch(() => null);
  if (!secret) return false;
  const { nonce } = await api<{ nonce: string }>('/auth/reauth/biometric/challenge', { method: 'POST' });
  const signature = bytesToHex(hmac(sha256, utf8ToBytes(secret), utf8ToBytes(nonce)));
  await api('/auth/reauth/biometric/verify', { body: { nonce, signature } });
  return true;
}
