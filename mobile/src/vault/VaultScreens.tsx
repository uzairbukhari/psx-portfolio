// Screens of the vault gate on the phone: create, save the recovery key, unlock, recover, erase. They only call into
// the shared vault client; passwords and the recovery key are handled in component state and never persisted.
import { useState } from 'react';
import { Share, Text, View } from 'react-native';
import { prepareVault, TransportError, type PreparedVault, type VaultCache, type VaultSession, type VaultStatus, type VaultTransport } from '../../../lib/vault-client.ts';
import { MIN_PASSWORD_CHARS, VaultError, decodeRecoverySecret } from '../../../lib/vault-crypto.ts';
import { useTheme } from '@/theme/ThemeProvider';
import { Button, Header, Input, Muted, Notice, Screen, useKitStyles, Card } from '@/ui/kit';

const messageOf = (e: unknown) => (e instanceof VaultError || e instanceof TransportError || e instanceof Error ? e.message : 'Something went wrong. Try again.');
const lengthOk = (value: string) => [...value.normalize('NFKC')].length >= MIN_PASSWORD_CHARS;

export function sameRecoveryKey(a: string, b: string): boolean {
  try {
    const x = decodeRecoverySecret(a);
    const y = decodeRecoverySecret(b);
    return x.length === y.length && x.every((byte, i) => byte === y[i]);
  } catch {
    return false;
  }
}

const passwordProps = (kind: 'new' | 'current') =>
  ({
    secureTextEntry: true,
    autoCapitalize: 'none' as const,
    autoCorrect: false,
    spellCheck: false,
    autoComplete: kind === 'new' ? ('new-password' as const) : ('current-password' as const),
    textContentType: kind === 'new' ? ('newPassword' as const) : ('password' as const),
  });

export function StatusScreen({
  title, message, busy, actionLabel, onAction, onSignOut,
}: {
  title: string; message?: string; busy?: boolean; actionLabel?: string; onAction?: () => void; onSignOut?: () => void;
}) {
  return (
    <Screen>
      <Header title={title} />
      {message ? <Notice tone="warn">{message}</Notice> : null}
      {busy ? <Muted>Please wait.</Muted> : null}
      {actionLabel && onAction ? <Button label={actionLabel} onPress={onAction} /> : null}
      {onSignOut ? <Button label="Sign out" variant="text" onPress={onSignOut} /> : null}
    </Screen>
  );
}

export function SetupScreen({
  transport, cache, onPrepared, onSignOut,
}: {
  transport: VaultTransport; cache: VaultCache; onPrepared: (prepared: PreparedVault) => void; onSignOut: () => void;
}) {
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit() {
    setError('');
    if (password !== again) return setError('The two passwords do not match.');
    setBusy(true);
    try {
      onPrepared(await prepareVault(transport, password, cache));
    } catch (e) {
      setError(messageOf(e));
      setBusy(false);
    }
  }
  return (
    <Screen>
      <Header title="Create your private vault" subtitle="Your holdings are encrypted on this phone before they are saved, so nobody else, including whoever runs Sipwise, can read them." />
      <Input label="Vault password" {...passwordProps('new')} value={password} onChangeText={setPassword} editable={!busy} hint={`At least ${MIN_PASSWORD_CHARS} characters. A passphrase of four or five random words works well; a password manager can store it.`} />
      <Input label="Repeat password" {...passwordProps('new')} value={again} onChangeText={setAgain} editable={!busy} />
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Button label={busy ? 'Creating keys…' : 'Continue'} loading={busy} disabled={!lengthOk(password) || !again} onPress={() => void submit()} />
      {busy ? <Muted>Deriving your key. This takes a few seconds on purpose.</Muted> : null}
      <Notice tone="info">Nobody can reset this password for you. Next you will get a recovery key; if you lose both, your data cannot be recovered.</Notice>
      <Button label="Sign out" variant="text" onPress={onSignOut} />
    </Screen>
  );
}

export function RecoveryKeyScreen({
  prepared, onDone, onBack,
}: {
  prepared: PreparedVault; onDone: (session: VaultSession) => void; onBack: () => void;
}) {
  const styles = useKitStyles();
  const { colors } = useTheme();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function finish() {
    setBusy(true);
    setError('');
    try {
      onDone(await prepared.finish());
    } catch (e) {
      setError(messageOf(e));
      setBusy(false);
    }
  }
  return (
    <Screen>
      <Header title="Save your recovery key" subtitle="If you forget your vault password, this key is the only way back in. We cannot recover it for you." />
      <Card>
        <Text selectable style={[styles.strong, { color: colors.ink, fontFamily: 'monospace', letterSpacing: 1 }]} accessibilityLabel="Recovery key">
          {prepared.recoverySecret}
        </Text>
      </Card>
      <Button
        label="Save or share the key"
        variant="tonal"
        onPress={() => void Share.share({ message: `Sipwise recovery key\n\n${prepared.recoverySecret}\n\nKeep this somewhere safe and private. If you lose both this key and your vault password, your data cannot be recovered.` }).catch(() => {})}
      />
      <Muted>Store it in a password manager or write it down. Keep it away from this phone's backups.</Muted>
      <Input label="Type or paste the key to confirm you saved it" value={typed} onChangeText={setTyped} autoCapitalize="characters" autoCorrect={false} spellCheck={false} editable={!busy} />
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Button label={busy ? 'Creating your vault…' : 'I saved it, create my vault'} loading={busy} disabled={!sameRecoveryKey(typed, prepared.recoverySecret)} onPress={() => void finish()} />
      <Button label="Back" variant="text" disabled={busy} onPress={onBack} />
    </Screen>
  );
}

export function UnlockScreen({
  status, mode, setMode, transport, cache, email, onOpen, onErased, onSignOut, unlock, recover,
}: {
  status: Extract<VaultStatus, { state: 'locked' }>;
  mode: 'password' | 'recover' | 'reset';
  setMode: (mode: 'password' | 'recover' | 'reset') => void;
  transport: VaultTransport;
  cache: VaultCache;
  email: string;
  onOpen: (session: VaultSession) => void;
  onErased: () => void;
  onSignOut: () => void;
  unlock: (transport: VaultTransport, status: Extract<VaultStatus, { state: 'locked' }>, secret: { password: string } | { recovery: string }, cache: VaultCache) => Promise<VaultSession>;
  recover: (transport: VaultTransport, status: Extract<VaultStatus, { state: 'locked' }>, recovery: string, newPassword: string, cache: VaultCache) => Promise<VaultSession>;
}) {
  const [password, setPassword] = useState('');
  const [recovery, setRecovery] = useState('');
  const [again, setAgain] = useState('');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function run(work: () => Promise<VaultSession | void>) {
    setBusy(true);
    setError('');
    try {
      const session = await work();
      if (session) onOpen(session);
    } catch (e) {
      setError(messageOf(e));
      setBusy(false);
    }
  }
  const back = () => { setError(''); setMode('password'); };
  if (mode === 'recover')
    return (
      <Screen>
        <Header title="Reset your vault password" subtitle="Enter your recovery key and choose a new vault password. Your portfolio stays as it is." />
        <Input label="Recovery key" value={recovery} onChangeText={setRecovery} autoCapitalize="characters" autoCorrect={false} spellCheck={false} editable={!busy} />
        <Input label="New vault password" {...passwordProps('new')} value={password} onChangeText={setPassword} editable={!busy} hint={`At least ${MIN_PASSWORD_CHARS} characters.`} />
        <Input label="Repeat new password" {...passwordProps('new')} value={again} onChangeText={setAgain} editable={!busy} />
        {error ? <Notice tone="error">{error}</Notice> : null}
        <Button
          label={busy ? 'Working…' : 'Reset password and open'}
          loading={busy}
          disabled={!recovery.trim() || !lengthOk(password)}
          onPress={() => {
            if (password !== again) return setError('The two passwords do not match.');
            void run(() => recover(transport, status, recovery, password, cache));
          }}
        />
        <Button label="Back" variant="text" disabled={busy} onPress={back} />
      </Screen>
    );
  if (mode === 'reset')
    return (
      <Screen>
        <Header title="Erase this vault" />
        <Notice tone="error">
          If you have lost both your vault password and your recovery key, the data cannot be recovered. You can erase it and start with an empty portfolio. This permanently deletes everything saved for {email}.
        </Notice>
        <Input label="Type ERASE to confirm" value={typed} onChangeText={setTyped} autoCapitalize="characters" autoCorrect={false} editable={!busy} />
        {error ? <Notice tone="error">{error}</Notice> : null}
        <Button label={busy ? 'Erasing…' : 'Erase vault and start over'} variant="destructive" loading={busy} disabled={typed.trim() !== 'ERASE'} onPress={() => void run(async () => { await transport.deleteVault(); onErased(); })} />
        <Button label="Back" variant="text" disabled={busy} onPress={back} />
      </Screen>
    );
  return (
    <Screen>
      <Header title="Unlock your vault" subtitle="Your portfolio is encrypted. Enter your vault password to open it. This is separate from your Google sign-in." />
      {status.offline ? <Notice tone="offline">You are offline. Your last saved copy can be opened, but changes cannot be saved until you reconnect.</Notice> : null}
      <Input label="Vault password" {...passwordProps('current')} value={password} onChangeText={setPassword} editable={!busy} />
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Button label={busy ? 'Unlocking…' : 'Unlock'} loading={busy} disabled={!password} onPress={() => void run(() => unlock(transport, status, { password }, cache))} />
      {busy ? <Muted>Deriving your key. This takes a few seconds.</Muted> : null}
      <View style={{ gap: 4 }}>
        <Button label="Forgot password? Use your recovery key" variant="text" disabled={busy} onPress={() => { setError(''); setMode('recover'); }} />
        <Button label="Lost both? Erase the vault" variant="text" disabled={busy} onPress={() => { setError(''); setMode('reset'); }} />
        <Button label="Sign out" variant="text" disabled={busy} onPress={onSignOut} />
      </View>
      <Muted>The vault locks when the app has been in the background for a minute.</Muted>
    </Screen>
  );
}
