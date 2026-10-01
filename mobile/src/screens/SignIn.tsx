import { useState } from 'react';
import { Pressable, Text } from 'react-native';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { useAuth } from '@/auth/AuthProvider';
import { config } from '@/config';
import { colors } from '@/theme/tokens';
import { Muted, Notice, Screen, styles } from '@/ui/kit';

export function SignIn() {
  const { signIn } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Screen>
      <Text style={{ color: colors.primary, fontSize: 32, fontWeight: '800', marginTop: 40 }}>Sipwise</Text>
      <Muted>Your private PSX portfolio and monthly SIP planner.</Muted>
      <Pressable
        style={[styles.button, busy && { opacity: 0.5 }]}
        disabled={busy}
        onPress={async () => {
          setBusy(true);
          setError(null);
          try {
            await signIn();
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Sign-in failed.');
          } finally {
            setBusy(false);
          }
        }}
      >
        <Text style={styles.buttonText}>{busy ? 'Signing in…' : 'Sign in with Google'}</Text>
      </Pressable>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {config.variant !== 'production' ? (
        <>
          <Muted>
            {config.variant} build · {config.apiBaseUrl || 'no API URL set'}
          </Muted>
          <Muted>
            Debug: package {Constants.expoConfig?.android?.package ?? '?'} · web client{' '}
            {config.googleWebClientId ? `${config.googleWebClientId.split('-')[1]?.slice(0, 12) ?? '?'}… (${config.googleWebClientId.length} chars)` : 'NOT SET'} ·{' '}
            {Updates.isEmbeddedLaunch ? 'built-in code (no update applied)' : `update ${Updates.updateId?.slice(0, 8) ?? '?'}`}
          </Muted>
        </>
      ) : null}
    </Screen>
  );
}
