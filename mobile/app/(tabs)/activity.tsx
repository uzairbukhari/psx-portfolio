import { useMemo } from 'react';
import { router } from 'expo-router';
import { activityEntries } from '@/data/derive';
import { usePortfolio } from '@/data/usePortfolio';
import { ActivityRow } from '@/ui/ActivityRow';
import { Card, EmptyState, Header, Loading, Notice, Screen } from '@/ui/kit';

export default function Activity() {
  const p = usePortfolio();
  const entries = useMemo(() => (p.portfolio ? activityEntries(p.portfolio) : []), [p.portfolio]);
  if (p.isLoading)
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  return (
    <Screen onRefresh={() => void p.refetch()} refreshing={p.isRefetching}>
      <Header title="Activity" subtitle={entries.length ? `${entries.length} entries, newest first` : undefined} />
      {p.error && !p.portfolio ? <Notice tone="error">{p.error.message}</Notice> : null}
      {entries.length === 0 ? (
        <EmptyState icon="activity" title="Nothing recorded yet" body="Trades and dividends you add or import will appear here." />
      ) : (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {entries.map((e, i) => (
            <ActivityRow
              key={e.id}
              entry={e}
              last={i === entries.length - 1}
              onPress={() => router.push({ pathname: '/company/[ticker]', params: { ticker: e.ticker } })}
            />
          ))}
        </Card>
      )}
    </Screen>
  );
}
