import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import type { PortfolioResponse } from '@shared/api-types.ts';
import { holdings } from '@shared/portfolio.ts';
import { useAuth } from '@/auth/AuthProvider';
import { config } from '@/config';
import { colors, radius } from '@/theme/tokens';

export default function Index() {
  const { state } = useAuth();
  if (state.status === 'loading')
    return (
      <Screen>
        <ActivityIndicator color={colors.primary} />
      </Screen>
    );
  return state.status === 'signedIn' ? <Home /> : <SignIn />;
}

function Screen({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>{children}</ScrollView>
    </SafeAreaView>
  );
}

function SignIn() {
  const { signIn } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Screen>
      <Text style={styles.brand}>Sipwise</Text>
      <Text style={styles.muted}>Your private PSX portfolio and monthly SIP planner.</Text>
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
        <Text style={styles.buttonText}>Sign in with Google</Text>
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {config.variant !== 'production' ? <Text style={styles.muted}>{config.variant} build · {config.apiBaseUrl || 'no API URL set'}</Text> : null}
    </Screen>
  );
}

// Phase 0 landing screen: proves sign-in, the API client and the shared lib/ code
// all work end to end on a device. The real Holdings screen replaces it in Phase 1.
function Home() {
  const { state, api, signOut } = useAuth();
  const user = state.status === 'signedIn' ? state.user : null;
  const portfolio = useQuery({ queryKey: ['portfolio'], queryFn: () => api.get<PortfolioResponse>('/api/portfolio') });
  const held = portfolio.data ? holdings(portfolio.data.portfolio) : null;
  return (
    <Screen>
      <Text style={styles.brand}>Sipwise</Text>
      <View style={styles.card}>
        <Text style={styles.label}>Signed in as</Text>
        <Text style={styles.value}>{user?.name ?? user?.email}</Text>
        <Text style={styles.muted}>{user?.email} · {user?.role}</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.label}>Portfolio</Text>
        {portfolio.isPending ? <ActivityIndicator color={colors.primary} /> : null}
        {portfolio.error ? <Text style={styles.error}>{portfolio.error.message}</Text> : null}
        {held ? <Text style={styles.value}>{held.length} holdings · revision {portfolio.data?.revision}</Text> : null}
      </View>
      <Pressable style={styles.secondary} onPress={() => void signOut()}>
        <Text style={styles.secondaryText}>Sign out</Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, gap: 16 },
  brand: { color: colors.primary, fontSize: 30, fontWeight: '800' },
  muted: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  card: { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: radius, padding: 18, gap: 6 },
  label: { color: colors.muted, fontSize: 13 },
  value: { color: colors.foreground, fontSize: 18, fontWeight: '600' },
  button: { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  buttonText: { color: colors.primaryForeground, fontWeight: '600', fontSize: 16 },
  secondary: { borderColor: colors.border, borderWidth: 1, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  secondaryText: { color: colors.foreground, fontSize: 15 },
  error: { color: colors.danger, fontSize: 14 },
});
