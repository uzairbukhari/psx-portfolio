import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { colors } from '@/theme/tokens';
import { coversContent, shouldLock } from './lock-policy';

const KEY = 'sipwise.lock';

type LockContextValue = {
  enabled: boolean;
  setEnabled: (on: boolean) => Promise<string | null>;
};
const LockContext = createContext<LockContextValue | null>(null);

export const useBiometricLock = () => {
  const value = useContext(LockContext);
  if (!value) throw new Error('useBiometricLock must be used inside BiometricLockProvider');
  return value;
};

const authenticate = (promptMessage: string) =>
  LocalAuthentication.authenticateAsync({ promptMessage, cancelLabel: 'Cancel' });

/** Optional lock: when on, opening the app (or returning after 30 seconds away) asks for fingerprint / face / device PIN. */
export function BiometricLockProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [enabled, setEnabledState] = useState(false);
  const [locked, setLocked] = useState(false);
  const [appActive, setAppActive] = useState(true);
  const backgroundedAt = useRef<number | null>(null);

  useEffect(() => {
    let live = true;
    SecureStore.getItemAsync(KEY)
      .then((v) => {
        if (!live) return;
        const on = v === '1';
        setEnabledState(on);
        setLocked(on);
      })
      .catch(() => {})
      .finally(() => live && setReady(true));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const sub = AppState.addEventListener('change', (next) => {
      setAppActive(next === 'active');
      if (next === 'background') backgroundedAt.current = Date.now();
      else if (next === 'active') {
        if (shouldLock(backgroundedAt.current, Date.now())) setLocked(true);
        backgroundedAt.current = null;
      }
    });
    return () => sub.remove();
  }, [enabled]);

  const unlock = useCallback(async () => {
    const result = await authenticate('Unlock Sipwise');
    if (result.success) setLocked(false);
  }, []);

  const setEnabled = useCallback(async (on: boolean) => {
    if (on) {
      if (!(await LocalAuthentication.hasHardwareAsync()) || !(await LocalAuthentication.isEnrolledAsync()))
        return 'Set up a fingerprint, face unlock or screen lock on this phone first.';
      const result = await authenticate('Confirm to turn on the app lock');
      if (!result.success) return 'The lock was not turned on.';
    }
    await SecureStore.setItemAsync(KEY, on ? '1' : '0');
    setEnabledState(on);
    setLocked(false);
    return null;
  }, []);

  const value = useMemo(() => ({ enabled, setEnabled }), [enabled, setEnabled]);

  const covered = coversContent(enabled, locked, appActive);

  if (!ready) return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  return (
    <LockContext.Provider value={value}>
      {/* The app stays mounted under the lock so screens (and half-typed forms) survive it, but screen
          readers must not be able to reach it, so it is hidden from accessibility while covered. */}
      <View
        style={{ flex: 1 }}
        importantForAccessibility={covered ? 'no-hide-descendants' : 'auto'}
        accessibilityElementsHidden={covered}
      >
        {children}
      </View>
      {covered ? (
        <View style={StyleSheet.absoluteFill} accessibilityViewIsModal>
          {locked ? <LockScreen onUnlock={unlock} /> : <PrivacyCover />}
        </View>
      ) : null}
    </LockContext.Provider>
  );
}

function LockScreen({ onUnlock }: { onUnlock: () => Promise<void> }) {
  useEffect(() => {
    void onUnlock();
  }, [onUnlock]);
  return (
    <View style={{ flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 }}>
      <Text style={{ color: colors.foreground, fontSize: 22, fontWeight: '700' }}>Sipwise is locked</Text>
      <Pressable
        onPress={() => void onUnlock()}
        style={{ backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 28 }}
      >
        <Text style={{ color: '#fff', fontWeight: '600', fontSize: 16 }}>Unlock</Text>
      </Pressable>
    </View>
  );
}

/** Plain cover shown while the app is not in the foreground, so the app switcher shows no portfolio data. */
function PrivacyCover() {
  return (
    <View style={{ flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: colors.foreground, fontSize: 22, fontWeight: '700' }}>Sipwise</Text>
    </View>
  );
}
