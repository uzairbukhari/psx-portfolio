import { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { MobileSessionsResponse } from '@shared/api-types.ts';
import { useAuth } from '@/auth/AuthProvider';
import { clearPortfolioCache } from '@/data/portfolio-cache';
import { config } from '@/config';
import { Card, Muted, Notice, Screen, Title, styles } from '@/ui/kit';

export default function Account() {
  const { state, api, signOut } = useAuth();
  const queryClient = useQueryClient();
  const user = state.status === 'signedIn' ? state.user : null;
  const [error, setError] = useState<string | null>(null);
  const devices = useQuery({
    queryKey: ['devices'],
    queryFn: () => api.get<MobileSessionsResponse>('/api/mobile-sessions'),
  });

  const revoke = (id: string, name: string) =>
    Alert.alert('Sign out this device?', name, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.delete(`/api/mobile-sessions?id=${encodeURIComponent(id)}`);
            await queryClient.invalidateQueries({ queryKey: ['devices'] });
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not sign out that device.');
          }
        },
      },
    ]);

  return (
    <Screen>
      <Title>Account</Title>
      <Card>
        <Text style={styles.strong}>{user?.name ?? user?.email}</Text>
        <Muted>
          {user?.email} · {user?.role === 'super_admin' ? 'admin' : 'member'}
        </Muted>
      </Card>
      <Title>Signed-in devices</Title>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {devices.error ? <Notice tone="error">{devices.error.message}</Notice> : null}
      <Card style={{ paddingVertical: 4 }}>
        {(devices.data?.sessions ?? []).map((d, i) => (
          <View key={d.id} style={[styles.row, { paddingVertical: 12 }, i ? { borderTopWidth: 1, borderTopColor: 'rgba(148,178,225,0.16)' } : undefined]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.strong}>{d.deviceName}</Text>
              <Muted>
                {d.platform} · last used {new Date(d.lastSeenAt).toLocaleDateString('en-GB', { dateStyle: 'medium' })}
              </Muted>
            </View>
            <Pressable onPress={() => revoke(d.id, d.deviceName)}>
              <Text style={{ color: '#ff5d6c' }}>Sign out</Text>
            </Pressable>
          </View>
        ))}
      </Card>
      <Pressable
        style={styles.secondary}
        onPress={async () => {
          if (user) clearPortfolioCache(user.email);
          await signOut();
        }}
      >
        <Text style={styles.secondaryText}>Sign out of this device</Text>
      </Pressable>
      <Muted>
        Sipwise {config.variant} · {config.apiBaseUrl}
      </Muted>
    </Screen>
  );
}
