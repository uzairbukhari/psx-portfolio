import { useEffect, useState } from 'react';
import { Alert, Image, Linking, Pressable, Share, Switch, Text, View } from 'react-native';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { MobileSessionsResponse, UsageResponse } from '@shared/api-types.ts';
import { useAuth, useEmail } from '@/auth/AuthProvider';
import { useBiometricLock } from '@/auth/BiometricLock';
import { backupShare, encryptedBackupShare } from '@/data/backup';
import { useVault } from '@/vault/VaultProvider';
import { setFilerStatus, type FilerStatus } from '@/data/mutations';
import { usePortfolio } from '@/data/usePortfolio';
import { pushAvailable, pushPreference, registerForPush, unregisterPush } from '@/push/push';
import { config } from '@/config';
import { APPEARANCES } from '@/theme/appearance';
import { useTheme } from '@/theme/ThemeProvider';
import { DeleteAccountSheet } from '@/ui/DeleteAccountSheet';
import { Icon } from '@/ui/Icon';
import { Button, Card, Chip, ListRow, Muted, Notice, Screen, Segmented, SectionLabel, Stat, StatusChip, useKitStyles } from '@/ui/kit';

/** More: account, appearance, security, notifications, tax status, AI usage, data and about. */
export default function More() {
  const styles = useKitStyles();
  const { colors, appearance, setAppearance } = useTheme();
  const { state, api, signOut, deleteAccount } = useAuth();
  const p = usePortfolio();
  const vault = useVault();
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

  async function shareText(result: { ok: true; text: string; title: string } | { ok: false; reason: string }) {
    if (!result.ok) return setError(result.reason);
    try {
      // Share sheet with the JSON as text: save it to Files, Drive or email it to yourself.
      await Share.share({ title: result.title, message: result.text });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open the share sheet.');
    }
  }

  /** Encrypted by default: the package is useless without the vault password or recovery key. */
  async function exportBackup() {
    setError(null);
    try {
      await shareText(encryptedBackupShare(await vault.session.backupPackage()));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the backup.');
    }
  }

  function exportReadable() {
    if (!p.portfolio) return;
    const portfolio = p.portfolio;
    Alert.alert(
      'Share a readable copy?',
      'This file is NOT encrypted. Anyone who gets it can read every holding, trade and note. Prefer the encrypted backup.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Share unencrypted', style: 'destructive', onPress: () => void shareText(backupShare(portfolio)) },
      ],
    );
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
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={name} size={18} color={colors.primary} />
    </View>
  );

  const isAdmin = user?.role === 'super_admin';
  const version = Constants.expoConfig?.version ?? '?';
  const updateId = Updates.isEmbeddedLaunch ? 'built-in code (no update applied)' : (Updates.updateId?.slice(0, 8) ?? '?');
  const webUrl = config.apiBaseUrl ? `${config.apiBaseUrl.replace(/\/$/, '')}/research-desk` : null;

  return (
    <Screen edges={['bottom']}>
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
          {isAdmin ? <StatusChip text="Admin" tone="primary" /> : null}
        </View>
      </Card>
      {error ? <Notice tone="error">{error}</Notice> : null}

      <SectionLabel>Appearance</SectionLabel>
      <Card>
        <Segmented label="Appearance" value={appearance} onChange={setAppearance} options={APPEARANCES.map((a) => ({ key: a.key, label: a.label }))} />
        <Muted>System follows your phone’s light or dark setting.</Muted>
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
            trackColor={{ true: colors.primary, false: colors.line }}
            thumbColor={colors.surface}
            onValueChange={(on) => {
              void lock.setEnabled(on).then((problem) => problem && setError(problem));
            }}
          />
        </View>
      </Card>
      <SectionLabel>Signed-in devices</SectionLabel>
      {devices.error ? <Notice tone="error">{devices.error.message}</Notice> : null}
      <View style={[styles.card, { padding: 0, overflow: 'hidden' }]}>
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
                onPress={() => revoke(d.id, d.deviceName)}
                style={{ minHeight: 48, justifyContent: 'center', paddingHorizontal: 8 }}
              >
                <Text style={{ color: colors.loss, fontWeight: '700' }}>Sign out</Text>
              </Pressable>
            }
            last={i === all.length - 1}
          />
        ))}
      </View>

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
            trackColor={{ true: colors.primary, false: colors.line }}
            thumbColor={colors.surface}
            onValueChange={(on) => void togglePush(on)}
          />
        </View>
        {pushNote ? <Muted>{pushNote}</Muted> : null}
        {pushOn ? <Button label="Send a test notification" variant="outline" loading={pushBusy} onPress={() => void sendTest()} /> : null}
      </Card>

      <SectionLabel>Tax status</SectionLabel>
      <Card>
        <Muted>Sets the rate Insights use to estimate tax on gains and dividends. Estimates are indicative, not your tax liability.</Muted>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} accessibilityRole="radiogroup">
          <Chip role="radio" label="Filer · 15%" accessibilityLabel="Filer, 15 percent tax" selected={filerStatus === 'filer'} onPress={() => void chooseFilerStatus('filer')} />
          <Chip role="radio" label="Non-filer · 30%" accessibilityLabel="Non-filer, 30 percent tax" selected={filerStatus === 'non-filer'} onPress={() => void chooseFilerStatus('non-filer')} />
        </View>
        {!p.portfolio ? <Muted>Loading your portfolio…</Muted> : taxBusy ? <Muted>Saving…</Muted> : null}
      </Card>

      {usage.data ? (
        <>
          <SectionLabel>AI usage this month</SectionLabel>
          <Card>
            <View style={styles.row}>
              <Stat label="Spent">
                <Text style={styles.number}>${usage.data.costUsd.toFixed(3)}</Text>
              </Stat>
              <Stat label="Tokens">
                <Text style={styles.number}>{(usage.data.inputTokens + usage.data.outputTokens).toLocaleString()}</Text>
              </Stat>
            </View>
          </Card>
        </>
      ) : null}

      <SectionLabel>Data</SectionLabel>
      <View style={[styles.card, { padding: 0, overflow: 'hidden' }]}>
        <ListRow left={iconBox('upload')} title="Import" subtitle="AHL trades and CDC dividends, with a preview first" onPress={() => router.push('/import')} />
        <ListRow left={iconBox('file')} title="Encrypted backup" subtitle="Share your whole ledger as an encrypted file. Restore it on the website with your vault password or recovery key." onPress={() => void exportBackup()} />
        <ListRow left={iconBox('file')} title="Readable export (not encrypted)" subtitle="Plain JSON anyone can read. Asks you to confirm first." onPress={exportReadable} />
        <ListRow left={iconBox('lock')} title="Lock Sipwise now" subtitle="Forget the vault key on this phone until you unlock it again." onPress={vault.lock} last />
      </View>
      <Card>
        <Muted>Permanently delete your account and everything stored for it on Sipwise.</Muted>
        <Button label="Delete account…" variant="destructive" onPress={() => setDeleting(true)} />
      </Card>
      {user ? <DeleteAccountSheet email={user.email} visible={deleting} onClose={() => setDeleting(false)} onDelete={deleteAccount} /> : null}

      {isAdmin && webUrl ? (
        <>
          <SectionLabel>Admin</SectionLabel>
          <View style={[styles.card, { padding: 0, overflow: 'hidden' }]}>
            <ListRow
              left={iconBox('external')}
              title="Research desk on the web"
              subtitle="Research opens in your browser, not in the app."
              onPress={() => void Linking.openURL(webUrl).catch(() => setError('Could not open the browser.'))}
              last
            />
          </View>
        </>
      ) : null}

      <Button
        label="Sign out of this device"
        variant="destructive"
        icon="logout"
        // Ends the server session (which also stops this phone's notifications) and clears all local data;
        // when offline the server part is retried on the next launch.
        onPress={() => void signOut()}
      />

      <SectionLabel>About</SectionLabel>
      <Card>
        <View style={styles.row}>
          <Stat label="Version">
            <Text style={styles.number}>{version}</Text>
          </Stat>
          <Stat label="Environment">
            <Text style={styles.number}>{config.variant}</Text>
          </Stat>
        </View>
        <Muted>Update: {updateId}</Muted>
        {config.variant !== 'production' ? (
          <>
            <Muted>Server: {config.apiBaseUrl || 'no API URL set'}</Muted>
            <Muted>
              Debug: package {Constants.expoConfig?.android?.package ?? '?'} · web client{' '}
              {config.googleWebClientId ? `${config.googleWebClientId.split('-')[1]?.slice(0, 12) ?? '?'}… (${config.googleWebClientId.length} chars)` : 'NOT SET'}
            </Muted>
          </>
        ) : null}
        <Muted>Sipwise tracks a PSX ledger and plans a monthly SIP. Prices are delayed. Not financial advice.</Muted>
      </Card>
    </Screen>
  );
}
