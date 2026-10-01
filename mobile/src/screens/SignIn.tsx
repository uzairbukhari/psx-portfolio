import { useState } from 'react';
import { Text, View } from 'react-native';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { useAuth } from '@/auth/AuthProvider';
import { config } from '@/config';
import { colors, type } from '@/theme/tokens';
import { Icon } from '@/ui/Icon';
import { Button, Muted, Notice, Screen, styles } from '@/ui/kit';

export function SignIn() {
  const { signIn } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Screen>
      <View style={{ alignItems: 'center', gap: 10, marginTop: 72, marginBottom: 28 }}>
        <View style={{ width: 84, height: 84, borderRadius: 24, backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="trendingUp" size={40} color={colors.primary} strokeWidth={2.2} />
        </View>
        <Text style={{ color: colors.foreground, ...type.largeTitle }}>Sipwise</Text>
        <Text style={[styles.muted, { textAlign: 'center', maxWidth: 280 }]}>
          Your private PSX portfolio and monthly SIP planner.
        </Text>
      </View>
      <Button
        label={busy ? 'Signing in…' : 'Sign in with Google'}
        loading={busy}
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
      />
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
