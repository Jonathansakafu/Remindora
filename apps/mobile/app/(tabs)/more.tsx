import { router, type Href } from 'expo-router';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { Glass, Screen, SectionLabel } from '../../src/components/ui';
import { api } from '../../src/lib/api';
import { useNotifications } from '../../src/lib/queries';
import { useSession } from '../../src/lib/session';
import { colors } from '../../src/lib/theme';
import { useTabBarSpace } from '../../src/lib/layout';

function Row({ label, hint, href, badge, onPress }: { label: string; hint?: string; href?: Href; badge?: number; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress ?? (() => href && router.push(href))} accessibilityRole="button" accessibilityHint={hint} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, opacity: pressed ? 0.7 : 1 })}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text, fontSize: 16 }}>{label}</Text>
        {hint ? <Text style={{ color: colors.textFaint, fontSize: 12, marginTop: 1 }}>{hint}</Text> : null}
      </View>
      {badge ? <Text style={{ color: '#2A0610', backgroundColor: colors.danger, borderRadius: 10, paddingHorizontal: 7, fontSize: 12, fontWeight: '700', overflow: 'hidden' }}>{badge}</Text> : null}
      <Text style={{ color: colors.textFaint, fontSize: 18, marginLeft: 8 }}>›</Text>
    </Pressable>
  );
}

export default function More() {
  const tabSpace = useTabBarSpace();
  const user = useSession((s) => s.user);
  const { data } = useNotifications();
  return (
    <Screen title="More" subtitle={user?.email}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: tabSpace + 36 }}>
        <SectionLabel>Plan your tasks</SectionLabel>
        <Glass>
          <Row label="Today" hint="Everything due today" href="/today" />
          <Row label="Inbox" hint="Quick notes and tasks without a date" href="/inbox" />
          <Row label="Upcoming" hint="The next 7 days" href="/upcoming" />
          <Row label="Calendar" hint="Your schedule by day" href="/calendar" />
        </Glass>
        <SectionLabel>Focus & habits</SectionLabel>
        <Glass>
          <Row label="Focus timer" hint="Pomodoro sessions" href="/focus" />
          <Row label="Habit tracker" hint="Streaks and history for your checklist" href="/habits" />
        </Glass>
        <SectionLabel>App</SectionLabel>
        <Glass>
          <Row label="Notifications" hint="Everything Remindora sent you" href="/notifications" badge={data?.unread} />
          <Row label="Settings" hint="Alarm sound, notifications, security" href="/settings" />
          <Row label="My devices" hint="Phones and computers signed in" href="/devices" />
          <Row label="Scan to link a device" hint="Sign in on this phone from your computer" href="/link" />
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
