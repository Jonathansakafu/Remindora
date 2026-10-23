import type { DeviceDTO } from '@remindora/types';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { DateTime } from 'luxon';
import { Alert, FlatList, Pressable, Text, View } from 'react-native';
import { Screen } from '../src/components/ui';
import { api } from '../src/lib/api';
import { showError } from '../src/lib/queries';
import { colors } from '../src/lib/theme';

const OS: Record<string, string> = { WEB: 'Web', DESKTOP_MACOS: 'macOS', DESKTOP_WINDOWS: 'Windows', DESKTOP_LINUX: 'Linux', ANDROID: 'Android', IOS: 'iOS', UNKNOWN: 'Unknown' };

export default function Devices() {
  const { data = [], refetch } = useQuery({ queryKey: ['devices'], queryFn: () => api<DeviceDTO[]>('/devices') });
  return (
    <Screen title="Linked devices" back>
      <FlatList
        data={data}
        keyExtractor={(d) => d.id}
        contentContainerStyle={{ padding: 16, gap: 10 }}
        renderItem={({ item: d }) => (
          <View style={{ padding: 14, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: 'rgba(17,28,62,0.6)', flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontWeight: '600' }}>{d.name}{d.current ? '  · this phone' : ''}</Text>
              <Text style={{ color: colors.textFaint, fontSize: 12, marginTop: 2 }}>{OS[d.platform]} · active {DateTime.fromISO(d.lastActiveAt).toRelative()}</Text>
            </View>
            {!d.current ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Revoke ${d.name}`}
                onPress={() => Alert.alert('Revoke device?', `${d.name} will be signed out immediately.`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Revoke', style: 'destructive', onPress: async () => { await api(`/devices/${d.id}`, { method: 'DELETE' }).catch(showError); void refetch(); } }])}
                style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: 'rgba(255,122,147,0.15)' }}
              >
                <Text style={{ color: colors.danger, fontWeight: '600' }}>Revoke</Text>
              </Pressable>
            ) : null}
          </View>
        )}
      />
    </Screen>
  );
}
