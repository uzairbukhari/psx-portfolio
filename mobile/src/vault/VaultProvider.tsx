// The only way in to the portfolio on the phone: signed in is not enough, the vault must be unlocked with the vault
// password (or the recovery key). The decrypted portfolio lives only in the VaultSession (memory) and in React
// Query's in-memory cache; locking zeroes the key, clears that cache and unmounts every screen below.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import type { PublicData } from '../../../lib/portfolio-view.ts';
import { loadVaultStatus, recoverWithKey, unlockVault, TransportError, type PreparedVault, type VaultSession, type VaultStatus } from '../../../lib/vault-client.ts';
import { VaultError } from '../../../lib/vault-crypto.ts';
import { useAuth } from '@/auth/AuthProvider';
import { useTheme } from '@/theme/ThemeProvider';
import { type } from '@/theme/tokens';
import { installMobileCrypto, type CryptoSetup } from './crypto-setup';
import { createFileVaultCache, clearVaultCache, purgeLegacyPlaintextCache } from './file-cache';
import { coversVault, shouldLockVault } from './lock-policy';
import { mobilePublicData, mobileVaultTransport } from './transport';
import { RecoveryKeyScreen, SetupScreen, StatusScreen, UnlockScreen } from './VaultScreens';

type VaultContextValue = {
  session: VaultSession;
  publicData: PublicData;
  lock: () => void;
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
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const sessionRef = useRef<VaultSession | null>(null);
  const backgroundedAt = useRef<number | null>(null);

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
      .then((status) => alive && setView(status.state === 'none' ? { kind: 'setup' } : { kind: 'locked', status, mode: 'password' }))
      .catch((e) => alive && setView({ kind: 'error', message: messageOf(e), upgrade: isUpgrade(e) }));
    return () => {
      alive = false;
      sessionRef.current?.lock();
      sessionRef.current = null;
    };
  }, [transport, cache, email]);

  const unlocked = view.kind === 'unlocked';
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      setAppActive(next === 'active');
      if (next === 'background') backgroundedAt.current = Date.now();
      else if (next === 'active') {
        if (sessionRef.current && shouldLockVault(backgroundedAt.current, Date.now())) void lockNow();
        backgroundedAt.current = null;
      }
    });
    return () => sub.remove();
  }, [lockNow]);

  const open = useCallback((session: VaultSession) => {
    sessionRef.current = session;
    setView({ kind: 'unlocked', session });
  }, []);

  const ctx = useMemo<VaultContextValue | null>(
    () => (view.kind === 'unlocked' ? { session: view.session, publicData, lock: () => void lockNow() } : null),
    [view, publicData, lockNow],
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
        onErased={() => { clearVaultCache(email); void refresh(); }}
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
