import { useState } from 'react';
import { Pressable, Text } from 'react-native';
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
        <Muted>
          {config.variant} build · {config.apiBaseUrl || 'no API URL set'}
        </Muted>
      ) : null}
    </Screen>
  );
}
