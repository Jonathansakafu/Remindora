import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { NotificationChannels } from '../src/components/notification-channels';
import { Button, Glass, Screen, SectionLabel } from '../src/components/ui';
import { api } from '../src/lib/api';
import { biometricsAvailable, enrollBiometricReauth, setAppLock, useLock } from '../src/lib/biometric';
import { openBatterySettings, openChannelSettings, openDndAccessSettings, registerForPush } from '../src/lib/push';
import { useSession } from '../src/lib/session';
import { colors } from '../src/lib/theme';
import { useSystemBottom } from '../src/lib/layout';

export default function Settings() {
  const systemBottom = useSystemBottom();
  const user = useSession((s) => s.user);
  const lock = useLock();
  const [perm, setPerm] = useState<string>('unknown');
  const [bio, setBio] = useState(false);
  useEffect(() => {
    void Notifications.getPermissionsAsync().then((p) => setPerm(p.status));
    void biometricsAvailable().then(setBio);
  }, []);

  return (
    <Screen title="Settings" right={<Pressable onPress={() => router.back()} accessibilityRole="button"><Text style={{ color: colors.cyan }}>Done</Text></Pressable>}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 4, paddingBottom: 60 + systemBottom }}>
        <SectionLabel>Notifications</SectionLabel>
        <Glass>
          <Text style={{ color: colors.text }}>Permission: {perm}</Text>
          <View style={{ gap: 8, marginTop: 10 }}>
            <Button label={perm === 'granted' ? 'Re-register this phone' : 'Enable notifications'} variant="primary" onPress={async () => setPerm(await registerForPush())} />
            <Button label="Send a test alert" onPress={() => api('/notifications/test', { body: { priority: 'HIGH' } }).then(() => Alert.alert('Sent', 'A test alert is on its way.'))} />
            <Button label="Channel sounds & vibration" onPress={openChannelSettings} />
          </View>
        </Glass>

        <SectionLabel>Where to notify me</SectionLabel>
        <NotificationChannels email={user?.email} />
        <Text style={{ color: colors.textFaint, fontSize: 12, marginTop: 6, marginHorizontal: 4 }}>These apply to all your devices. Repeat intervals and quiet hours are on the web or desktop app.</Text>

        <SectionLabel>Reliability</SectionLabel>
        <Glass>
          <Text style={{ color: colors.textMuted }}>Some phones delay notifications to save battery. Exempt Remindora so critical reminders arrive on time.</Text>
          <View style={{ gap: 8, marginTop: 10 }}>
            <Button label="Battery optimisation settings" onPress={openBatterySettings} />
            <Button label="Allow critical alerts during Do Not Disturb" onPress={openDndAccessSettings} />
          </View>
        </Glass>

        <SectionLabel>Security</SectionLabel>
        <Glass>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text }}>Biometric app lock</Text>
              <Text style={{ color: colors.textFaint, fontSize: 12 }}>{bio ? 'Unlock with fingerprint or face after 30 s away.' : 'Set up a fingerprint or face unlock in Android settings first.'}</Text>
            </View>
            <Switch value={lock.enabled} disabled={!bio} onValueChange={(v) => void setAppLock(v)} accessibilityLabel="Biometric app lock" trackColor={{ true: colors.cyan, false: colors.surface }} />
          </View>
          <View style={{ marginTop: 12 }}>
            <Button label="Use biometrics to confirm sensitive actions" disabled={!bio} onPress={() => enrollBiometricReauth().then((ok) => Alert.alert(ok ? 'Enabled' : 'Not available', ok ? 'Your fingerprint or face now confirms device linking.' : 'Sign in again, then retry.')).catch(() => Alert.alert('Sign in again to enable this.'))} />
          </View>
        </Glass>

        <SectionLabel>Account</SectionLabel>
        <Glass>
          <Text style={{ color: colors.text }}>{user?.email}</Text>
          <Text style={{ color: colors.textFaint, fontSize: 12, marginTop: 2 }}>Timezone: {user?.timezone}</Text>
        </Glass>
      </ScrollView>
    </Screen>
  );
}
