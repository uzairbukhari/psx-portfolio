import { useState } from 'react';
import { Text, View } from 'react-native';
import { useAuth } from '@/auth/AuthProvider';
import { useTheme } from '@/theme/ThemeProvider';
import { type } from '@/theme/tokens';
import { Icon, type IconName } from '@/ui/Icon';
import { Button, Notice, Screen, useKitStyles } from '@/ui/kit';

const POINTS: { icon: IconName; title: string; body: string }[] = [
  { icon: 'list', title: 'Track every buy, sale and dividend', body: 'Average cost and gains, with fees included.' },
  { icon: 'steps', title: 'Plan each month', body: 'Split your budget across target companies in whole shares.' },
  { icon: 'refresh', title: 'Delayed PSX prices', body: 'Each value shows the date of the price it used. Syncs with the Sipwise website.' },
];

/** Welcome and sign-in in one screen: what Sipwise tracks, then Continue with Google. Debug details live in More › About. */
export function SignIn() {
  const { signIn, signOutPending } = useAuth();
  const styles = useKitStyles();
  const { colors } = useTheme();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Screen>
      <View style={{ alignItems: 'center', gap: 10, marginTop: 40, marginBottom: 12 }}>
        <View style={{ width: 72, height: 72, borderRadius: 20, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="steps" size={36} color={colors.onPrimary} strokeWidth={2.4} />
          <View style={{ position: 'absolute', top: 14, right: 14, width: 9, height: 9, borderRadius: 5, backgroundColor: colors.brandMint }} />
        </View>
        <Text style={{ color: colors.ink, ...type.title, fontSize: 30, lineHeight: 36 }} accessibilityRole="header">
          Sipwise
        </Text>
        <Text style={[styles.muted, { textAlign: 'center', maxWidth: 300 }]}>Your PSX ledger and monthly SIP planner.</Text>
      </View>
      <View style={[styles.card, { padding: 0, overflow: 'hidden' }]}>
        {POINTS.map((pt, i) => (
          <View key={pt.title} accessible accessibilityLabel={`${pt.title}. ${pt.body}`} style={[styles.listRow, { alignItems: 'flex-start', paddingVertical: 14 }, i < POINTS.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.line }]}>
            <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={pt.icon} size={20} color={colors.primary} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.strong}>{pt.title}</Text>
              <Text style={styles.muted}>{pt.body}</Text>
            </View>
          </View>
        ))}
      </View>
      <Button
        label={busy ? 'Signing in…' : 'Continue with Google'}
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
      {signOutPending ? <Notice>Your last sign-out could not reach Sipwise (you were offline). It will finish the next time the app opens with a connection.</Notice> : null}
    </Screen>
  );
}
