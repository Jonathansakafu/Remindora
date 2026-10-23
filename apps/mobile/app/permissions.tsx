import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Pressable, ScrollView, Text, View } from 'react-native';
import { Screen } from '../src/components/ui';
import { useAlarm } from '../src/lib/alarm';
import { useSystemBottom } from '../src/lib/layout';
import { openBatterySettings, openDndAccessSettings, PERMISSIONS_DONE_KEY, registerForPush } from '../src/lib/push';
import { colors } from '../src/lib/theme';

function Step({ n, title, body, done, action, onPress }: { n: number; title: string; body: string; done?: boolean; action: string; onPress: () => void }) {
  return (
    <View style={{ flexDirection: 'row', gap: 14, padding: 16, marginBottom: 12, borderRadius: 18, borderWidth: 1, borderColor: done ? 'rgba(124,243,176,0.45)' : colors.border, backgroundColor: 'rgba(17,28,62,0.7)' }}>
      <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: done ? colors.success : colors.surfaceHigh, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: done ? '#06122E' : colors.text, fontWeight: '800' }}>{done ? '✓' : n}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700' }}>{title}</Text>
        <Text style={{ color: colors.textMuted, marginTop: 4, lineHeight: 20 }}>{body}</Text>
        <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => ({ alignSelf: 'flex-start', marginTop: 12, paddingHorizontal: 16, height: 44, borderRadius: 12, justifyContent: 'center', backgroundColor: done ? 'transparent' : colors.cyan, borderWidth: done ? 1 : 0, borderColor: colors.border, opacity: pressed ? 0.85 : 1 })}>
          <Text style={{ color: done ? colors.text : '#06122E', fontWeight: '800' }}>{action}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** Asks for everything an alarm needs on Android, step by step. Shown once after sign-in and from Settings. */
export default function Permissions() {
  const systemBottom = useSystemBottom();
  const [notif, setNotif] = useState<string>('undetermined');
  const [opened, setOpened] = useState<{ dnd?: boolean; battery?: boolean }>({});

  const refresh = useCallback(() => {
    void Notifications.getPermissionsAsync().then((p) => setNotif(p.status));
  }, []);
  useEffect(() => {
    refresh();
    // Coming back from a system settings page: re-check.
    const sub = AppState.addEventListener('change', (s) => s === 'active' && refresh());
    return () => sub.remove();
  }, [refresh]);

  async function finish() {
    await AsyncStorage.setItem(PERMISSIONS_DONE_KEY, '1');
    if (router.canGoBack()) router.back();
    else router.replace('/reminders');
  }

  return (
    <Screen title="Set up alarms" subtitle="So your reminders ring on time, every time">
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 + systemBottom }}>
        <Step
          n={1}
          title="Allow notifications"
          body="Needed for reminders to ring and show on your screen, even when Remindora is closed."
          done={notif === 'granted'}
          action={notif === 'granted' ? 'Allowed' : notif === 'denied' ? 'Open notification settings' : 'Allow notifications'}
          onPress={async () => {
            if (notif === 'denied') {
              const { openSettings } = await import('expo-linking');
              await openSettings();
              return;
            }
            setNotif(await registerForPush());
          }}
        />
        <Step
          n={2}
          title="Ring even in Do Not Disturb"
          body="Find Remindora in the list and switch it on, so alarms still ring when your phone is on silent or Do Not Disturb."
          done={opened.dnd}
          action={opened.dnd ? 'Open again' : 'Open setting'}
          onPress={() => {
            setOpened((o) => ({ ...o, dnd: true }));
            void openDndAccessSettings();
          }}
        />
        <Step
          n={3}
          title="Don’t delay my alarms"
          body="Some phones pause apps to save battery. Choose “Unrestricted” (or “Don’t optimise”) for Remindora so alarms arrive exactly on time."
          done={opened.battery}
          action={opened.battery ? 'Open again' : 'Open battery settings'}
          onPress={() => {
            setOpened((o) => ({ ...o, battery: true }));
            void openBatterySettings();
          }}
        />
        <Step
          n={4}
          title="Test the alarm"
          body="Play the alarm now to check it’s loud enough. It uses your phone’s alarm volume."
          action="Play test alarm"
          onPress={() => useAlarm.getState().ring({ notificationId: `test-${Date.now()}`, taskId: null, title: 'Test alarm', body: 'This is how your reminders will ring.', test: true })}
        />
        <Pressable onPress={finish} accessibilityRole="button" style={({ pressed }) => ({ marginTop: 8, height: 58, borderRadius: 18, backgroundColor: colors.cyan, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.85 : 1 })}>
          <Text style={{ color: '#06122E', fontSize: 17, fontWeight: '800' }}>Done</Text>
        </Pressable>
        <Text style={{ color: colors.textFaint, fontSize: 12, textAlign: 'center', marginTop: 12 }}>You can come back here any time from More → Settings.</Text>
      </ScrollView>
    </Screen>
  );
}
