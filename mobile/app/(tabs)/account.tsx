import { useEffect, useState } from 'react';
import { Alert, Image, Pressable, Share, Switch, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { MobileSessionsResponse, UsageResponse } from '@shared/api-types.ts';
import { useAuth, useEmail } from '@/auth/AuthProvider';
import { useBiometricLock } from '@/auth/BiometricLock';
import { backupShare } from '@/data/backup';
import { setFilerStatus, type FilerStatus } from '@/data/mutations';
import { usePortfolio } from '@/data/usePortfolio';
import { pushAvailable, pushPreference, registerForPush, unregisterPush } from '@/push/push';
import { config } from '@/config';
import { colors } from '@/theme/tokens';
import { DeleteAccountSheet } from '@/ui/DeleteAccountSheet';
import { Icon } from '@/ui/Icon';
import { Badge, Button, Card, Chip, Header, ListRow, Muted, Notice, Screen, SectionLabel, Stat, styles } from '@/ui/kit';

export default function Account() {
  const { state, api, signOut, deleteAccount } = useAuth();
  const p = usePortfolio();
  const [taxBusy, setTaxBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const queryClient = useQueryClient();
  const email = useEmail();
  const lock = useBiometricLock();
  const [pushOn, setPushOn] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushNote, setPushNote] = useState<string | null>(null);
  useEffect(() => {
    void pushPreference.get().then(setPushOn);
  }, []);

  async function togglePush(on: boolean) {
    setPushBusy(true);
    setPushNote(null);
    try {
      if (on) {
        const problem = await registerForPush(api);
        if (problem) return setPushNote(problem);
      } else await unregisterPush(api);
      await pushPreference.set(on);
      setPushOn(on);
    } catch (e) {
      setPushNote(e instanceof Error ? e.message : 'Could not change notifications.');
    } finally {
      setPushBusy(false);
    }
  }

  async function sendTest() {
    setPushBusy(true);
    setPushNote(null);
    try {
      await api.post('/api/mobile-push/test');
      setPushNote('Test sent. It should arrive in a few seconds.');
    } catch (e) {
      setPushNote(e instanceof Error ? e.message : 'Could not send the test.');
    } finally {
      setPushBusy(false);
    }
  }
  const user = state.status === 'signedIn' ? state.user : null;
  const filerStatus = p.portfolio?.taxProfile?.filerStatus ?? '';

  async function chooseFilerStatus(status: FilerStatus) {
    if (!p.portfolio || status === filerStatus) return;
    setTaxBusy(true);
    setError(null);
    try {
      await p.save(setFilerStatus(p.portfolio, status));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save your tax status.');
    } finally {
      setTaxBusy(false);
    }
  }

  async function exportBackup() {
    if (!p.portfolio) return;
    setError(null);
    const result = backupShare(p.portfolio);
    if (!result.ok) return setError(result.reason);
    try {
      // Share sheet with the JSON as text: save it to Files, Drive or email it to yourself.
      await Share.share({ title: result.title, message: result.text });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open the share sheet.');
    }
  }
  const [error, setError] = useState<string | null>(null);
  const devices = useQuery({
    queryKey: ['devices', email],
    queryFn: () => api.get<MobileSessionsResponse>('/api/mobile-sessions'),
  });

  const usage = useQuery({
    queryKey: ['usage', email],
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
            await queryClient.invalidateQueries({ queryKey: ['devices', email] });
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
            <Image accessibilityIgnoresInvertColors accessible={false} source={{ uri: user.picture }} style={{ width: 52, height: 52, borderRadius: 26 }} />
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

      <SectionLabel>Tax status</SectionLabel>
      <Card>
        <Muted>Sets the rate Reports use to estimate tax on gains and dividends. Estimates are indicative, not your tax liability.</Muted>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} accessibilityRole="radiogroup">
          <Chip role="radio" label="Filer · 15%" accessibilityLabel="Filer, 15 percent tax" selected={filerStatus === 'filer'} onPress={() => void chooseFilerStatus('filer')} />
          <Chip role="radio" label="Non-filer · 30%" accessibilityLabel="Non-filer, 30 percent tax" selected={filerStatus === 'non-filer'} onPress={() => void chooseFilerStatus('non-filer')} />
        </View>
        {!p.portfolio ? <Muted>Loading your portfolio…</Muted> : taxBusy ? <Muted>Saving…</Muted> : null}
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
            accessibilityLabel="App lock"
            value={lock.enabled}
            trackColor={{ true: colors.primary }}
            onValueChange={(on) => {
              void lock.setEnabled(on).then((problem) => problem && setError(problem));
            }}
          />
        </View>
      </Card>

      <SectionLabel>Notifications</SectionLabel>
      <Card>
        <View style={styles.row}>
          {iconBox('bell')}
          <View style={{ flex: 1 }}>
            <Text style={styles.strong}>Dividend alerts</Text>
            <Muted>
              {pushAvailable() ? 'Get a notification when a company you hold announces a payout.' : 'Needs the latest build of the app, on a real phone.'}
            </Muted>
          </View>
          <Switch
            accessibilityLabel="Dividend alerts"
            value={pushOn}
            disabled={pushBusy || !pushAvailable()}
            trackColor={{ true: colors.primary }}
            onValueChange={(on) => void togglePush(on)}
          />
        </View>
        {pushNote ? <Muted>{pushNote}</Muted> : null}
        {pushOn ? <Button label="Send a test notification" variant="secondary" loading={pushBusy} onPress={() => void sendTest()} /> : null}
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
            right={
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Sign out ${d.deviceName}`}
                hitSlop={12}
                onPress={() => revoke(d.id, d.deviceName)}
                style={{ minHeight: 44, justifyContent: 'center', paddingLeft: 8 }}
              >
                <Text style={{ color: colors.danger, fontWeight: '600' }}>Sign out</Text>
              </Pressable>
            }
            last={i === all.length - 1}
          />
        ))}
      </Card>

      <SectionLabel>Your data</SectionLabel>
      <Card>
        <Muted>Share a backup of your whole ledger as a JSON file. The website's Settings can restore it.</Muted>
        <Button label="Export backup" variant="secondary" icon="upload" disabled={!p.portfolio} onPress={() => void exportBackup()} />
        <View style={styles.divider} />
        <Muted>Permanently delete your account and everything stored for it on Sipwise.</Muted>
        <Button label="Delete account…" variant="danger" onPress={() => setDeleting(true)} />
      </Card>
      {user ? <DeleteAccountSheet email={user.email} visible={deleting} onClose={() => setDeleting(false)} onDelete={deleteAccount} /> : null}

      <Button
        label="Sign out of this device"
        variant="danger"
        icon="logout"
        // Ends the server session (which also stops this phone's notifications) and clears all local data;
        // when offline the server part is retried on the next launch.
        onPress={() => void signOut()}
      />
      <Text style={[styles.muted, { textAlign: 'center' }]}>
        Sipwise {config.variant} · {config.apiBaseUrl}
      </Text>
    </Screen>
  );
}
