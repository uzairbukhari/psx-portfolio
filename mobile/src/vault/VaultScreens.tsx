// Screens of the vault gate on the phone: create, save the recovery key, unlock, recover, erase. They only call into
// the shared vault client; passwords and the recovery key are handled in component state and never persisted.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Image, Pressable, Share, Text, View } from 'react-native';
import { prepareVault, TransportError, type PreparedVault, type VaultCache, type VaultSession, type VaultStatus, type VaultTransport } from '../../../lib/vault-client.ts';
import { MIN_PASSWORD_CHARS, VaultError, decodeRecoverySecret, onKdfProgress } from '../../../lib/vault-crypto.ts';
import { useTheme } from '@/theme/ThemeProvider';
import { Button, Card, Input, Muted, Notice, Screen, StatusChip, useKitStyles } from '@/ui/kit';
import { radii, type } from '@/theme/tokens';

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


/** Brand block shared by every vault screen, so the gate reads as one considered flow instead of bare forms. */
function VaultFrame({ title, subtitle, step, children }: { title: string; subtitle?: string; step?: string; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <Screen edges={['top', 'bottom']}>
      <View style={{ alignItems: 'center', gap: 10, paddingTop: 12, paddingBottom: 4 }}>
        <Image source={require('../../assets/icon.png')} style={{ width: 64, height: 64, borderRadius: 16 }} accessibilityIgnoresInvertColors />
        <Text style={{ color: colors.ink, ...type.headline, letterSpacing: 0.2 }}>Sipwise</Text>
        <StatusChip text="Private, encrypted vault" icon="lock" tone="primary" />
      </View>
      <View style={{ gap: 6, paddingVertical: 8 }}>
        {step ? <Text style={{ color: colors.primary, ...type.overline }}>{step}</Text> : null}
        <Text accessibilityRole="header" style={{ color: colors.ink, ...type.title }}>{title}</Text>
        {subtitle ? <Text style={{ color: colors.muted, ...type.body }}>{subtitle}</Text> : null}
      </View>
      {children}
    </Screen>
  );
}

/** Password field with a Show / Hide switch, so a long passphrase can be checked before it is submitted. */
function PasswordField({ label, kind, value, onChangeText, editable, hint }: { label: string; kind: 'new' | 'current'; value: string; onChangeText: (v: string) => void; editable: boolean; hint?: string }) {
  const { colors } = useTheme();
  const [shown, setShown] = useState(false);
  return (
    <View style={{ gap: 2 }}>
      <Input label={label} {...passwordProps(kind)} secureTextEntry={!shown} value={value} onChangeText={onChangeText} editable={editable} hint={hint} />
      <Pressable accessibilityRole="button" accessibilityLabel={shown ? 'Hide password' : 'Show password'} onPress={() => setShown(!shown)} hitSlop={8} style={{ alignSelf: 'flex-end', minHeight: 36, justifyContent: 'center' }}>
        <Text style={{ color: colors.primary, ...type.caption, fontWeight: '600' }}>{shown ? 'Hide' : 'Show'}</Text>
      </Pressable>
    </View>
  );
}

/**
 * Shown while the key is derived from the password. On a phone this takes a while (the derivation is deliberately
 * expensive and runs without native help), so say so, show real progress and the time spent, instead of a bare spinner.
 */
function Deriving({ active, what }: { active: boolean; what: string }) {
  const { colors } = useTheme();
  const [fraction, setFraction] = useState(0);
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!active) return;
    setFraction(0);
    setSeconds(0);
    const began = Date.now();
    let last = 0;
    const stop = onKdfProgress((f) => {
      if (f - last >= 0.01 || f >= 1) {
        last = f;
        setFraction(f);
      }
    });
    const timer = setInterval(() => setSeconds(Math.round((Date.now() - began) / 1000)), 1000);
    return () => {
      stop();
      clearInterval(timer);
    };
  }, [active]);
  if (!active) return null;
  const percent = Math.min(100, Math.round(fraction * 100));
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <ActivityIndicator color={colors.primary} />
        <Text style={{ color: colors.ink, ...type.headline, flex: 1 }}>{what}</Text>
        <Text style={{ color: colors.muted, ...type.number }}>{percent}%</Text>
      </View>
      <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: percent }} style={{ height: 8, borderRadius: radii.pill, backgroundColor: colors.raised, overflow: 'hidden' }}>
        <View style={{ width: `${percent}%`, height: '100%', backgroundColor: colors.primary, borderRadius: radii.pill }} />
      </View>
      <Muted>{`Securing your key takes a while on a phone. ${seconds}s so far. Keep the app open. Fingerprint unlock skips this next time.`}</Muted>
    </Card>
  );
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
  const { colors } = useTheme();
  return (
    <VaultFrame title={title}>
      {message ? <Notice tone="warn">{message}</Notice> : null}
      {busy ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <ActivityIndicator color={colors.primary} />
          <Muted>Please wait.</Muted>
        </View>
      ) : null}
      {actionLabel && onAction ? <Button label={actionLabel} onPress={onAction} /> : null}
      {onSignOut ? <Button label="Sign out" variant="text" onPress={onSignOut} /> : null}
    </VaultFrame>
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
    <VaultFrame
      step="Step 1 of 2"
      title="Create your vault password"
      subtitle="Your holdings are encrypted on this phone before they are saved, so nobody else, including whoever runs Sipwise, can read them."
    >
      <Card>
        <PasswordField label="Vault password" kind="new" value={password} onChangeText={setPassword} editable={!busy} hint={`At least ${MIN_PASSWORD_CHARS} characters. A passphrase of four or five random words works well; a password manager can store it.`} />
        <PasswordField label="Repeat password" kind="new" value={again} onChangeText={setAgain} editable={!busy} />
        {error ? <Notice tone="error">{error}</Notice> : null}
        <Button label="Continue" loading={busy} disabled={!lengthOk(password) || !again} onPress={() => void submit()} />
      </Card>
      <Deriving active={busy} what="Creating your keys" />
      <Notice tone="info">Nobody can reset this password for you. Next you will get a recovery key; if you lose both, your data cannot be recovered.</Notice>
      <Button label="Sign out" variant="text" disabled={busy} onPress={onSignOut} />
    </VaultFrame>
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
    <VaultFrame
      step="Step 2 of 2"
      title="Save your recovery key"
      subtitle="If you forget your vault password, this key is the only way back in. We cannot recover it for you."
    >
      <Card tone="hero">
        <Text selectable style={[styles.strong, { color: colors.ink, fontFamily: 'monospace', letterSpacing: 1, textAlign: 'center' }]} accessibilityLabel="Recovery key">
          {prepared.recoverySecret}
        </Text>
      </Card>
      <Button
        label="Save or share the key"
        variant="tonal"
        icon="upload"
        onPress={() => void Share.share({ message: `Sipwise recovery key\n\n${prepared.recoverySecret}\n\nKeep this somewhere safe and private. If you lose both this key and your vault password, your data cannot be recovered.` }).catch(() => {})}
      />
      <Muted>Store it in a password manager or write it down. Keep it away from this phone's backups.</Muted>
      <Card>
        <Input label="Type or paste the key to confirm you saved it" value={typed} onChangeText={setTyped} autoCapitalize="characters" autoCorrect={false} spellCheck={false} editable={!busy} />
        {error ? <Notice tone="error">{error}</Notice> : null}
        <Button label="I saved it, create my vault" loading={busy} disabled={!sameRecoveryKey(typed, prepared.recoverySecret)} onPress={() => void finish()} />
      </Card>
      <Button label="Back" variant="text" disabled={busy} onPress={onBack} />
    </VaultFrame>
  );
}

export function UnlockScreen({
  status, mode, setMode, transport, cache, email, onOpen, biometric, onErased, onSignOut, unlock, recover,
}: {
  status: Extract<VaultStatus, { state: 'locked' }>;
  mode: 'password' | 'recover' | 'reset';
  setMode: (mode: 'password' | 'recover' | 'reset') => void;
  transport: VaultTransport;
  cache: VaultCache;
  email: string;
  onOpen: (session: VaultSession, options?: { rememberBiometric?: boolean }) => void;
  /** Fingerprint / face unlock: whether this phone can offer it, whether a key is stored, and how to use it. */
  biometric: { canOffer: boolean; has: boolean; unlock: () => Promise<string | null> };
  onErased: () => void;
  onSignOut: () => void;
  unlock: (transport: VaultTransport, status: Extract<VaultStatus, { state: 'locked' }>, secret: { password: string } | { recovery: string }, cache: VaultCache) => Promise<VaultSession>;
  recover: (transport: VaultTransport, status: Extract<VaultStatus, { state: 'locked' }>, recovery: string, newPassword: string, cache: VaultCache) => Promise<VaultSession>;
}) {
  const { colors } = useTheme();
  const [password, setPassword] = useState('');
  const [recovery, setRecovery] = useState('');
  const [again, setAgain] = useState('');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [deriving, setDeriving] = useState(false);
  const [error, setError] = useState('');
  // Ticked by default where the phone supports it: the slow password derivation then happens once per phone.
  const [remember, setRemember] = useState(true);
  async function useBiometric() {
    setBusy(true);
    setError('');
    const problem = await biometric.unlock();
    if (problem) { setError(problem); setBusy(false); }
  }
  // Offer the fingerprint prompt straight away, once per time the lock screen appears; Cancel falls back to the password.
  const autoTried = useRef(false);
  useEffect(() => {
    if (mode === 'password' && biometric.has && !autoTried.current) {
      autoTried.current = true;
      void useBiometric();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [biometric.has, mode]);
  async function run(work: () => Promise<VaultSession | void>) {
    setBusy(true);
    setDeriving(true);
    setError('');
    try {
      const session = await work();
      if (session) onOpen(session, { rememberBiometric: remember });
    } catch (e) {
      setError(messageOf(e));
      setBusy(false);
      setDeriving(false);
    }
  }
  const back = () => { setError(''); setMode('password'); };
  if (mode === 'recover')
    return (
      <VaultFrame title="Reset your vault password" subtitle="Enter your recovery key and choose a new vault password. Your portfolio stays as it is.">
        <Card>
          <Input label="Recovery key" value={recovery} onChangeText={setRecovery} autoCapitalize="characters" autoCorrect={false} spellCheck={false} editable={!busy} />
          <PasswordField label="New vault password" kind="new" value={password} onChangeText={setPassword} editable={!busy} hint={`At least ${MIN_PASSWORD_CHARS} characters.`} />
          <PasswordField label="Repeat new password" kind="new" value={again} onChangeText={setAgain} editable={!busy} />
          {error ? <Notice tone="error">{error}</Notice> : null}
          <Button
            label="Reset password and open"
            loading={busy}
            disabled={!recovery.trim() || !lengthOk(password)}
            onPress={() => {
              if (password !== again) return setError('The two passwords do not match.');
              void run(() => recover(transport, status, recovery, password, cache));
            }}
          />
        </Card>
        <Deriving active={deriving} what="Securing your new password" />
        <Button label="Back" variant="text" disabled={busy} onPress={back} />
      </VaultFrame>
    );
  if (mode === 'reset')
    return (
      <VaultFrame title="Erase this vault">
        <Notice tone="error">
          If you have lost both your vault password and your recovery key, the data cannot be recovered. You can erase it and start with an empty portfolio. This permanently deletes everything saved for {email}.
        </Notice>
        <Card>
          <Input label="Type ERASE to confirm" value={typed} onChangeText={setTyped} autoCapitalize="characters" autoCorrect={false} editable={!busy} />
          {error ? <Notice tone="error">{error}</Notice> : null}
          <Button label="Erase vault and start over" variant="destructive" loading={busy} disabled={typed.trim() !== 'ERASE'} onPress={() => void run(async () => { await transport.deleteVault(); onErased(); })} />
        </Card>
        <Button label="Back" variant="text" disabled={busy} onPress={back} />
      </VaultFrame>
    );
  return (
    <VaultFrame title="Welcome back" subtitle={email ? `Unlock the vault for ${email}. This is separate from your Google sign-in.` : 'Your portfolio is encrypted. Unlock it to continue.'}>
      {status.offline ? <Notice tone="offline">You are offline. Your last saved copy can be opened, but changes cannot be saved until you reconnect.</Notice> : null}
      {biometric.has ? <Button label="Unlock with fingerprint or face" icon="lock" disabled={busy} onPress={() => void useBiometric()} /> : null}
      <Card>
        <PasswordField label="Vault password" kind="current" value={password} onChangeText={setPassword} editable={!busy} />
        {biometric.canOffer && !biometric.has ? (
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: remember }} disabled={busy} onPress={() => setRemember(!remember)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48 }}>
            <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: remember ? colors.primary : colors.outline, backgroundColor: remember ? colors.primary : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
              {remember ? <Text style={{ color: colors.onPrimary, fontSize: 14, lineHeight: 16, fontWeight: '700' }}>✓</Text> : null}
            </View>
            <View style={{ flex: 1 }}><Muted>Unlock with fingerprint or face next time. The key stays on this phone, protected by your biometrics.</Muted></View>
          </Pressable>
        ) : null}
        {error ? <Notice tone="error">{error}</Notice> : null}
        <Button label={biometric.has ? 'Unlock with password' : 'Unlock'} variant={biometric.has ? 'outline' : 'primary'} loading={busy && !biometric.has} disabled={!password || busy} onPress={() => void run(() => unlock(transport, status, { password }, cache))} />
      </Card>
      <Deriving active={deriving} what="Unlocking your vault" />
      <View style={{ gap: 4 }}>
        <Button label="Forgot password? Use your recovery key" variant="text" disabled={busy} onPress={() => { setError(''); setMode('recover'); }} />
        <Button label="Lost both? Erase the vault" variant="text" disabled={busy} onPress={() => { setError(''); setMode('reset'); }} />
        <Button label="Sign out" variant="text" disabled={busy} onPress={onSignOut} />
      </View>
      <Muted>The vault locks when the app has been in the background for a minute.</Muted>
    </VaultFrame>
  );
}
