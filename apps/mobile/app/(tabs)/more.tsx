import { router, type Href } from 'expo-router';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { Screen } from '../../src/components/ui';
import { api } from '../../src/lib/api';
import { useTabBarSpace } from '../../src/lib/layout';
import { useNotifications } from '../../src/lib/queries';
import { useSession } from '../../src/lib/session';
import { colors } from '../../src/lib/theme';

type Tile = { label: string; hint: string; icon: string; href: Href; badge?: number };
type Group = { title: string; text: string; icon: string; tint: string; tiles: Tile[] };

function Card({ group }: { group: Group }) {
  return (
    <View style={{ marginBottom: 14, padding: 14, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: 'rgba(17,28,62,0.72)' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: group.tint, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 22 }} accessible={false}>
            {group.icon}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text accessibilityRole="header" style={{ color: colors.text, fontSize: 17, fontWeight: '700' }}>
            {group.title}
          </Text>
          <Text style={{ color: colors.textMuted, fontSize: 13 }}>{group.text}</Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {group.tiles.map((t) => (
          <Pressable
            key={t.label}
            onPress={() => router.push(t.href)}
            accessibilityRole="button"
            accessibilityLabel={`${t.label}. ${t.hint}`}
            style={({ pressed }) => ({ width: '48.5%', minHeight: 84, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: pressed ? 'rgba(96,233,255,0.08)' : 'rgba(7,13,34,0.55)', justifyContent: 'space-between' })}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 20 }} accessible={false}>
                {t.icon}
              </Text>
              {t.badge ? <Text style={{ color: '#06122E', backgroundColor: colors.danger, borderRadius: 10, paddingHorizontal: 7, fontSize: 12, fontWeight: '800', overflow: 'hidden', alignSelf: 'flex-start' }}>{t.badge}</Text> : null}
            </View>
            <View>
              <Text style={{ color: colors.text, fontSize: 15, fontWeight: '700' }}>{t.label}</Text>
              <Text style={{ color: colors.textFaint, fontSize: 12 }} numberOfLines={1}>
                {t.hint}
              </Text>
            </View>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export default function More() {
  const tabSpace = useTabBarSpace();
  const user = useSession((s) => s.user);
  const { data } = useNotifications();

  const groups: Group[] = [
    {
      title: 'Plan your tasks',
      text: 'See what’s due and organise your day',
      icon: '🗓️',
      tint: 'rgba(96,233,255,0.15)',
      tiles: [
        { label: 'Today', hint: 'Due today', icon: '☀️', href: '/today' },
        { label: 'Inbox', hint: 'No date yet', icon: '📥', href: '/inbox' },
        { label: 'Upcoming', hint: 'Next 7 days', icon: '📆', href: '/upcoming' },
        { label: 'Calendar', hint: 'Your schedule', icon: '🗓️', href: '/calendar' },
      ],
    },
    {
      title: 'Focus & habits',
      text: 'Concentrate and build routines',
      icon: '🎯',
      tint: 'rgba(124,243,176,0.15)',
      tiles: [
        { label: 'Focus timer', hint: 'Pomodoro sessions', icon: '🎯', href: '/focus' },
        { label: 'Habit tracker', hint: 'Streaks & history', icon: '🔥', href: '/habits' },
      ],
    },
    {
      title: 'App & account',
      text: 'Settings, alerts and devices',
      icon: '⚙️',
      tint: 'rgba(255,255,255,0.08)',
      tiles: [
        { label: 'Settings', hint: 'Alarm, notifications', icon: '⚙️', href: '/settings' },
        { label: 'Set up alarms', hint: 'Permissions', icon: '⏰', href: '/permissions' },
        { label: 'Notifications', hint: 'Everything sent', icon: '🔔', href: '/notifications', badge: data?.unread },
        { label: 'My devices', hint: 'Signed-in devices', icon: '📱', href: '/devices' },
        { label: 'Link a device', hint: 'Scan a QR code', icon: '🔗', href: '/link' },
        { label: 'About', hint: 'Who built it', icon: 'ℹ️', href: '/about' },
      ],
    },
  ];

  return (
    <Screen title="More" subtitle={user?.email}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: tabSpace + 16 }}>
        {groups.map((g) => (
          <Card key={g.title} group={g} />
        ))}
        <Pressable
          onPress={() =>
            Alert.alert('Sign out?', 'This phone will be unlinked from your account.', [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Sign out',
                style: 'destructive',
                onPress: async () => {
                  await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
                  await useSession.getState().clear();
                },
              },
            ])
          }
          accessibilityRole="button"
          style={({ pressed }) => ({ height: 52, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,122,147,0.4)', alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}
        >
          <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 15 }}>Sign out</Text>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}
