import { useMemo } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { money } from '@shared/portfolio.ts';
import { activityEntries } from '@/data/derive';
import { usePortfolio } from '@/data/usePortfolio';
import { colors } from '@/theme/tokens';
import { ActivityRow } from '@/ui/ActivityRow';
import { Card, Muted, Notice, Screen, Title } from '@/ui/kit';

export default function Activity() {
  const p = usePortfolio();
  const entries = useMemo(() => (p.portfolio ? activityEntries(p.portfolio) : []), [p.portfolio]);
  if (p.isLoading)
    return (
      <Screen>
        <ActivityIndicator color={colors.primary} style={{ marginTop: 60 }} />
      </Screen>
    );
  return (
    <Screen onRefresh={() => void p.refetch()} refreshing={p.isRefetching}>
      <Title>Activity</Title>
      {p.error && !p.portfolio ? <Notice tone="error">{p.error.message}</Notice> : null}
      {entries.length === 0 ? <Muted>No trades or dividends recorded yet.</Muted> : null}
      <Card style={{ paddingVertical: 4 }}>
        {entries.map((e, i) => (
          <Pressable key={e.id} onPress={() => router.push({ pathname: '/company/[ticker]', params: { ticker: e.ticker } })}>
            <View style={i ? { borderTopWidth: 1, borderTopColor: colors.border } : undefined}>
              <ActivityRow entry={e} />
            </View>
          </Pressable>
        ))}
      </Card>
    </Screen>
  );
}
