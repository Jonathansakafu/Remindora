import { BlurView } from 'expo-blur';
import { Tabs } from 'expo-router';
import { StyleSheet, Text } from 'react-native';
import { colors } from '../../src/lib/theme';

const ICONS: Record<string, string> = { today: '☀', inbox: '⇩', calendar: '▦', focus: '◎', more: '⋯' };

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.cyan,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarStyle: { position: 'absolute', backgroundColor: 'transparent', borderTopColor: colors.border, height: 64, paddingBottom: 8 },
        tabBarBackground: () => <BlurView intensity={40} tint="dark" style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(11,19,48,0.75)' }]} />,
        tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }} accessible={false}>{ICONS[route.name]}</Text>,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      })}
    >
      <Tabs.Screen name="today" options={{ title: 'Today' }} />
      <Tabs.Screen name="inbox" options={{ title: 'Inbox' }} />
      <Tabs.Screen name="calendar" options={{ title: 'Calendar' }} />
      <Tabs.Screen name="focus" options={{ title: 'Focus' }} />
      <Tabs.Screen name="more" options={{ title: 'More' }} />
    </Tabs>
  );
}
