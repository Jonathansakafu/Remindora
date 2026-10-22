import { router, type Href } from 'expo-router';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { Glass, Screen } from '../../src/components/ui';
import { api } from '../../src/lib/api';
import { useNotifications } from '../../src/lib/queries';
import { useSession } from '../../src/lib/session';
import { colors } from '../../src/lib/theme';

function Row({ label, href, badge, onPress }: { label: string; href?: Href; badge?: number; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress ?? (() => href && router.push(href))} accessibilityRole="button" style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, opacity: pressed ? 0.7 : 1 })}>
      <Text style={{ color: colors.text, fontSize: 16, flex: 1 }}>{label}</Text>
      {badge ? <Text style={{ color: '#2A0610', backgroundColor: colors.danger, borderRadius: 10, paddingHorizontal: 7, fontSize: 12, fontWeight: '700', overflow: 'hidden' }}>{badge}</Text> : null}
      <Text style={{ color: colors.textFaint, fontSize: 18, marginLeft: 8 }}>›</Text>
    </Pressable>
  );
}

export default function More() {
  const user = useSession((s) => s.user);
  const { data } = useNotifications();
  return (
    <Screen title="More" subtitle={user?.email}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 100 }}>
        <Glass>
          <Row label="Notifications" href="/notifications" badge={data?.unread} />
          <Row label="Upcoming" href="/upcoming" />
          <Row label="Habits" href="/habits" />
        </Glass>
        <Glass>
          <Row label="Linked devices" href="/devices" />
          <Row label="Scan to link a device" href="/link" />
          <Row label="Settings" href="/settings" />
          <Row label="About Remindora" href="/about" />
        </Glass>
        <Glass>
          <Row
            label="Sign out"
            onPress={() =>
              Alert.alert('Sign out?', 'This phone will be unlinked from your account.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Sign out', style: 'destructive', onPress: async () => { await api('/auth/logout', { method: 'POST' }).catch(() => undefined); await useSession.getState().clear(); } },
              ])
            }
          />
        </Glass>
        <View style={{ alignItems: 'center', marginTop: 8 }}><Text style={{ color: colors.textFaint, fontSize: 12 }}>Remindora for Android</Text></View>
      </ScrollView>
    </Screen>
  );
}
