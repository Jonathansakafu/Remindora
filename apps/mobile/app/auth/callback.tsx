import type { AuthTokensDTO } from '@remindora/types';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator } from 'react-native';
import { Screen } from '../../src/components/ui';
import { api } from '../../src/lib/api';
import { useSession } from '../../src/lib/session';
import { colors } from '../../src/lib/theme';

/** OAuth deep link: remindora://auth/callback?code=… → swap the one-time code for tokens. */
export default function OAuthCallback() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  const accept = useSession((s) => s.accept);
  useEffect(() => {
    if (!code) return void router.replace('/login');
    api<AuthTokensDTO>('/auth/oauth/exchange', { body: { code }, auth: false })
      .then(accept)
      .then(() => router.replace('/today'))
      .catch(() => router.replace('/login'));
  }, [code, accept]);
  return (
    <Screen>
      <ActivityIndicator color={colors.cyan} style={{ marginTop: 120 }} />
    </Screen>
  );
}
