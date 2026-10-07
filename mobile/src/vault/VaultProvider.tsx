// The only way in to the portfolio on the phone: signed in is not enough, the vault must be unlocked with the vault
// password (or the recovery key). The decrypted portfolio lives only in the VaultSession (memory) and in React
// Query's in-memory cache; locking zeroes the key, clears that cache and unmounts every screen below.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import type { PublicData } from '../../../lib/portfolio-view.ts';
import { loadVaultStatus, openWithKey, recoverWithKey, unlockVault, TransportError, type PreparedVault, type VaultSession, type VaultStatus } from '../../../lib/vault-client.ts';
import { VaultError } from '../../../lib/vault-crypto.ts';
import { useAuth } from '@/auth/AuthProvider';
import { useTheme } from '@/theme/ThemeProvider';
import { type } from '@/theme/tokens';
import { forgetBiometricKey, hasBiometricKey, recallBiometricKey, saveBiometricKey } from './biometric-key';
import { nativeBiometricKeyStore } from './biometric-key-native';
import { installMobileCrypto, type CryptoSetup } from './crypto-setup';
import { createFileVaultCache, clearVaultCache, purgeLegacyPlaintextCache } from './file-cache';
import { useAppActive } from '@/auth/app-active';
import { reportAccountState } from '@/analytics/analytics';
import { coversVault, shouldLockVault } from './lock-policy';
import { mobilePublicData, mobileVaultTransport } from './transport';
import { RecoveryKeyScreen, SetupScreen, StatusScreen, UnlockScreen } from './VaultScreens';

type VaultContextValue = {
  session: VaultSession;
  publicData: PublicData;
  lock: () => void;
  /** Fingerprint / face unlock: whether this phone can do it, whether it is on, and a switch (returns a problem message or null). */
  biometric: { supported: boolean; enabled: boolean; set: (on: boolean) => Promise<string | null> };
};
const VaultContext = createContext<VaultContextValue | null>(null);

/** The unlocked vault. Only available below the gate, which renders nothing until the vault is open. */
export function useVault(): VaultContextValue {
  const value = useContext(VaultContext);
  if (!value) throw new Error('useVault must be used inside an unlocked VaultGate.');
  return value;
}

type Screen =
  | { kind: 'loading' }
  | { kind: 'error'; message: string; upgrade: boolean }
  | { kind: 'setup' }
  | { kind: 'recovery-key'; prepared: PreparedVault }
  | { kind: 'locked'; status: Extract<VaultStatus, { state: 'locked' }>; mode: 'password' | 'recover' | 'reset' }
  | { kind: 'unlocked'; session: VaultSession };

const messageOf = (error: unknown) => (error instanceof Error ? error.message : 'Something went wrong. Try again.');
const isUpgrade = (error: unknown) => error instanceof TransportError && error.status === 426;

export function VaultGate({ children }: { children: ReactNode }) {
  const { api, state, signOut } = useAuth();
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const email = state.status === 'signedIn' ? state.user.email : '';
  const [view, setView] = useState<Screen>({ kind: 'loading' });
  const appActive = useAppActive();
  const sessionRef = useRef<VaultSession | null>(null);
  const backgroundedAt = useRef<number | null>(null);
  const [bioOn, setBioOn] = useState(false);
  const bioStore = nativeBiometricKeyStore;

  const transport = useMemo(() => mobileVaultTransport(api), [api]);
  const publicData = useMemo(() => mobilePublicData(api), [api]);
  const cache = useMemo(() => createFileVaultCache(email), [email]);

  const refresh = useCallback(async () => {
    try {
      const status = await loadVaultStatus(transport, cache);
      setView(status.state === 'none' ? { kind: 'setup' } : { kind: 'locked', status, mode: 'password' });
    } catch (e) {
      setView({ kind: 'error', message: messageOf(e), upgrade: isUpgrade(e) });
    }
  }, [transport, cache]);

  const lockNow = useCallback(async () => {
    const session = sessionRef.current;
    sessionRef.current = null;
    session?.lock();
    // The decrypted portfolio also sits in React Query's cache; nothing readable may outlive the lock.
    queryClient.clear();
    await refresh();
  }, [queryClient, refresh]);

  useEffect(() => {
    // The readable cache older versions kept on disk goes as soon as the new build runs.
    purgeLegacyPlaintextCache();
  }, []);

  useEffect(() => {
    let alive = true;
    setView({ kind: 'loading' });
    const crypto: CryptoSetup = installMobileCrypto();
    if (!crypto.ok) {
      setView({ kind: 'error', message: crypto.reason, upgrade: true });
      return;
    }
    loadVaultStatus(transport, cache)
      .then((status) => {
        if (!alive) return;
        void reportAccountState(status.state !== 'none');
        setView(status.state === 'none' ? { kind: 'setup' } : { kind: 'locked', status, mode: 'password' });
      })
      .catch((e) => alive && setView({ kind: 'error', message: messageOf(e), upgrade: isUpgrade(e) }));
    return () => {
      alive = false;
      sessionRef.current?.lock();
      sessionRef.current = null;
    };
  }, [transport, cache, email]);

  const vaultId = view.kind === 'locked' ? view.status.vault.vaultId : view.kind === 'unlocked' ? view.session.vaultId : null;
  useEffect(() => {
    let alive = true;
    if (!vaultId || !email) return setBioOn(false);
    void hasBiometricKey(bioStore, email, vaultId).then((on) => alive && setBioOn(on));
    return () => { alive = false; };
  }, [vaultId, email, bioStore]);

  const unlocked = view.kind === 'unlocked';
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'background') backgroundedAt.current = Date.now();
      else if (next === 'active') {
        if (sessionRef.current && shouldLockVault(backgroundedAt.current, Date.now())) void lockNow();
        backgroundedAt.current = null;
      }
    });
    return () => sub.remove();
  }, [lockNow]);

  const open = useCallback((session: VaultSession, options?: { rememberBiometric?: boolean }) => {
    sessionRef.current = session;
    setView({ kind: 'unlocked', session });
    // Opt-in from the unlock screen: only after the password (or recovery key) has just opened the vault.
    if (options?.rememberBiometric) void saveBiometricKey(bioStore, email, session.vaultId, session.exportKey()).then(setBioOn);
  }, [bioStore, email]);

  /** Opens the vault with the biometric-protected key. Returns a message for the unlock screen, or null once open. */
  const unlockWithBiometric = useCallback(
    async (status: Extract<VaultStatus, { state: 'locked' }>): Promise<string | null> => {
      const key = await recallBiometricKey(bioStore, email, status.vault.vaultId);
      if (!key) return 'Fingerprint unlock was cancelled. Enter your vault password instead.';
      try {
        open(await openWithKey(transport, status, key, cache));
        return null;
      } catch (e) {
        if (e instanceof VaultError) {
          // The stored key no longer opens this vault (key rotated, vault replaced): drop it and use the password.
          await forgetBiometricKey(bioStore, email);
          setBioOn(false);
          return 'Fingerprint unlock is no longer valid. Enter your vault password.';
        }
        return messageOf(e);
      }
    },
    [bioStore, email, open, transport, cache],
  );

  const setBiometric = useCallback(
    async (on: boolean): Promise<string | null> => {
      const session = sessionRef.current;
      if (!on) {
        await forgetBiometricKey(bioStore, email);
        setBioOn(false);
        return null;
      }
      if (!session) return 'Unlock the vault first.';
      if (!bioStore.available()) return 'Set up a fingerprint or face unlock on this phone first.';
      const saved = await saveBiometricKey(bioStore, email, session.vaultId, session.exportKey());
      setBioOn(saved);
      return saved ? null : 'Fingerprint unlock was not turned on.';
    },
    [bioStore, email],
  );

  const ctx = useMemo<VaultContextValue | null>(
    () => (view.kind === 'unlocked' ? { session: view.session, publicData, lock: () => void lockNow(), biometric: { supported: bioStore.available(), enabled: bioOn, set: setBiometric } } : null),
    [view, publicData, lockNow, bioStore, bioOn, setBiometric],
  );

  let body: ReactNode;
  if (view.kind === 'unlocked' && ctx) body = <VaultContext.Provider value={ctx}>{children}</VaultContext.Provider>;
  else if (view.kind === 'loading') body = <StatusScreen title="Checking your private vault…" busy />;
  else if (view.kind === 'error')
    body = (
      <StatusScreen
        title={view.upgrade ? 'Update needed' : 'We could not open your vault'}
        message={view.message}
        actionLabel={view.upgrade ? undefined : 'Try again'}
        onAction={view.upgrade ? undefined : () => { setView({ kind: 'loading' }); void refresh(); }}
        onSignOut={() => void signOut()}
      />
    );
  else if (view.kind === 'setup')
    body = <SetupScreen transport={transport} cache={cache} onPrepared={(prepared) => setView({ kind: 'recovery-key', prepared })} onSignOut={() => void signOut()} />;
  else if (view.kind === 'recovery-key')
    body = <RecoveryKeyScreen prepared={view.prepared} onDone={open} onBack={() => { view.prepared.discard(); setView({ kind: 'setup' }); }} />;
  else if (view.kind === 'locked')
    body = (
      <UnlockScreen
        status={view.status}
        mode={view.mode}
        setMode={(mode) => setView({ ...view, mode })}
        transport={transport}
        cache={cache}
        email={email}
        onOpen={open}
        biometric={{ canOffer: bioStore.available(), has: bioOn, unlock: () => unlockWithBiometric(view.status) }}
        onErased={() => { void forgetBiometricKey(bioStore, email); setBioOn(false); clearVaultCache(email); void refresh(); }}
        onSignOut={() => void signOut()}
        unlock={unlockVault}
        recover={recoverWithKey}
      />
    );
  else body = <StatusScreen title="Checking your private vault…" busy />;

  return (
    <View style={{ flex: 1 }}>
      {body}
      {coversVault(unlocked, appActive) ? (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }]} accessibilityViewIsModal>
          <Text style={{ color: colors.ink, ...type.title }}>Sipwise</Text>
        </View>
      ) : null}
    </View>
  );
}

export { VaultError };
