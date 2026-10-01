import { useState } from 'react';
import { Alert, Image, Switch, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { MobileSessionsResponse, UsageResponse } from '@shared/api-types.ts';
import { useAuth } from '@/auth/AuthProvider';
import { useBiometricLock } from '@/auth/BiometricLock';
import { clearPortfolioCache } from '@/data/portfolio-cache';
import { config } from '@/config';
import { colors } from '@/theme/tokens';
import { Icon } from '@/ui/Icon';
import { Badge, Button, Card, Header, ListRow, Muted, Notice, Screen, SectionLabel, Stat, styles } from '@/ui/kit';

export default function Account() {
  const { state, api, signOut } = useAuth();
  const queryClient = useQueryClient();
  const lock = useBiometricLock();
  const user = state.status === 'signedIn' ? state.user : null;
  const [error, setError] = useState<string | null>(null);
  const devices = useQuery({
    queryKey: ['devices'],
    queryFn: () => api.get<MobileSessionsResponse>('/api/mobile-sessions'),
  });

  const usage = useQuery({
    queryKey: ['usage'],
    queryFn: () => api.get<UsageResponse>('/api/usage'),
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

  const initials = (user?.name ?? user?.email ?? '?').slice(0, 1).toUpperCase();
  const iconBox = (name: Parameters<typeof Icon>[0]['name']) => (
    <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={name} size={18} color={colors.primary} />
    </View>
  );

  return (
    <Screen>
      <Header title="Account" />
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          {user?.picture ? (
            <Image source={{ uri: user.picture }} style={{ width: 52, height: 52, borderRadius: 26 }} />
          ) : (
            <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: colors.primary, fontSize: 22, fontWeight: '700' }}>{initials}</Text>
            </View>
          )}
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.strong} numberOfLines={1}>{user?.name ?? user?.email}</Text>
            <Muted>{user?.email}</Muted>
          </View>
          {user?.role === 'super_admin' ? <Badge text="Admin" tone="primary" /> : null}
        </View>
      </Card>
      {error ? <Notice tone="error">{error}</Notice> : null}

      <SectionLabel>Tools</SectionLabel>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <ListRow left={iconBox('chart')} title="Reports" subtitle="Allocation, gains, income and tax" onPress={() => router.push('/reports')} />
        <ListRow left={iconBox('sparkle')} title="Monthly Picks" subtitle="AI-ranked ideas for this month's SIP" onPress={() => router.push('/picks')} />
        <ListRow left={iconBox('upload')} title="Import" subtitle="AHL trades and CDC dividends" onPress={() => router.push('/import')} last />
      </Card>

      <SectionLabel>Security</SectionLabel>
      <Card>
        <View style={styles.row}>
          {iconBox('lock')}
          <View style={{ flex: 1 }}>
            <Text style={styles.strong}>App lock</Text>
            <Muted>Ask for fingerprint, face or screen lock when opening the app.</Muted>
          </View>
          <Switch
            value={lock.enabled}
            trackColor={{ true: colors.primary }}
            onValueChange={(on) => {
              void lock.setEnabled(on).then((problem) => problem && setError(problem));
            }}
          />
        </View>
      </Card>

      {usage.data ? (
        <>
          <SectionLabel>AI usage</SectionLabel>
          <Card>
            <View style={styles.row}>
              <Stat label="Spent">
                <Text style={styles.strong}>${usage.data.costUsd.toFixed(3)}</Text>
              </Stat>
              <Stat label="Tokens">
                <Text style={styles.strong}>{(usage.data.inputTokens + usage.data.outputTokens).toLocaleString()}</Text>
              </Stat>
            </View>
          </Card>
        </>
      ) : null}

      <SectionLabel>Signed-in devices</SectionLabel>
      {devices.error ? <Notice tone="error">{devices.error.message}</Notice> : null}
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {(devices.data?.sessions ?? []).map((d, i, all) => (
          <ListRow
            key={d.id}
            left={iconBox('phone')}
            title={d.deviceName}
            subtitle={`${d.platform} · last used ${new Date(d.lastSeenAt).toLocaleDateString('en-GB', { dateStyle: 'medium' })}`}
            right={<Text style={{ color: colors.danger, fontWeight: '600' }} onPress={() => revoke(d.id, d.deviceName)}>Sign out</Text>}
            last={i === all.length - 1}
          />
        ))}
      </Card>

      <Button
        label="Sign out of this device"
        variant="danger"
        icon="logout"
        onPress={async () => {
          if (user) clearPortfolioCache(user.email);
          await signOut();
        }}
      />
      <Text style={[styles.muted, { textAlign: 'center' }]}>
        Sipwise {config.variant} · {config.apiBaseUrl}
      </Text>
    </Screen>
  );
}
