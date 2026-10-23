import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import * as Notifications from 'expo-notifications';
import { Stack, router, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { AppState, Pressable, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { authenticate, loadLockPreference, useLock } from '../src/lib/biometric';
import { flushOutbox, watchConnectivity } from '../src/lib/offline';
import { handleResponse, registerForPush, setupChannelsAndActions } from '../src/lib/push';
import { refetchTasks } from '../src/lib/queries';
import { connectRealtime, disconnectRealtime } from '../src/lib/realtime';
import { adoptDeviceTimezone, refreshSession, useSession } from '../src/lib/session';
import { colors } from '../src/lib/theme';

void SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 20_000, gcTime: 7 * 86_400_000, networkMode: 'offlineFirst', retry: 1 } } });
const persister = createAsyncStoragePersister({ storage: AsyncStorage, throttleTime: 2000 });

/** Biometric app lock: re-locks after 30 s in the background. */
function LockOverlay() {
  const { enabled, locked } = useLock();
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'background') useLock.setState({ lastActive: Date.now() });
      if (s === 'active' && useLock.getState().enabled && Date.now() - useLock.getState().lastActive > 30_000) useLock.setState({ locked: true });
    });
    return () => sub.remove();
  }, []);
  useEffect(() => {
    if (enabled && locked) void authenticate('Unlock Remindora').then((ok) => ok && useLock.setState({ locked: false }));
  }, [enabled, locked]);
  if (!enabled || !locked) return null;
  return (
    <View style={{ position: 'absolute', inset: 0, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }} accessibilityViewIsModal>
      <Text style={{ color: colors.text, fontSize: 20, fontWeight: '700' }}>Remindora is locked</Text>
      <Pressable onPress={() => authenticate('Unlock Remindora').then((ok) => ok && useLock.setState({ locked: false }))} accessibilityRole="button" style={{ marginTop: 20, backgroundColor: colors.cyan, borderRadius: 14, paddingHorizontal: 24, paddingVertical: 12 }}>
        <Text style={{ color: '#06122E', fontWeight: '700' }}>Unlock</Text>
      </Pressable>
    </View>
  );
}

export default function RootLayout() {
  const status = useSession((s) => s.status);
  const sessionId = useSession((s) => s.sessionId);
  const segments = useSegments();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void (async () => {
      await loadLockPreference();
      await setupChannelsAndActions().catch(() => undefined);
      const ok = await refreshSession();
      if (!ok && useSession.getState().status === 'loading') useSession.setState({ status: 'signed_out' });
      setReady(true);
      await SplashScreen.hideAsync();
    })();
    return watchConnectivity(() => void flushOutbox(() => refetchTasks(queryClient)));
  }, []);

  // Auth gate: public screens are login, link (QR) and the OAuth callback.
  useEffect(() => {
    if (!ready) return;
    const publicRoute = segments[0] === 'login' || segments[0] === 'link' || segments[0] === 'auth' || segments[0] === 'about';
    if (status === 'signed_out' && !publicRoute) router.replace('/login');
    if (status === 'signed_in' && segments[0] === 'login') router.replace('/today');
  }, [status, segments, ready]);

  useEffect(() => {
    if (status !== 'signed_in') return;
    connectRealtime(queryClient);
    void registerForPush().catch(() => undefined);
    void adoptDeviceTimezone();
    return () => disconnectRealtime();
  }, [status, sessionId]);

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((r) => void handleResponse(r, (id) => router.push({ pathname: '/task', params: { id } })));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (status === 'signed_out') queryClient.clear();
  }, [status]);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <PersistQueryClientProvider client={queryClient} persistOptions={{ persister, maxAge: 7 * 86_400_000, buster: sessionId ?? 'anon' }}>
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: 'fade' }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="login" />
          <Stack.Screen name="link" options={{ presentation: 'modal' }} />
          <Stack.Screen name="task" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        </Stack>
        <LockOverlay />
      </PersistQueryClientProvider>
    </GestureHandlerRootView>
  );
}
