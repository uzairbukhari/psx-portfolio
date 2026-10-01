import { useMemo, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { router } from 'expo-router';
import {
  clearAll,
  clearOne,
  deleteCleared,
  expectedDividendFor,
  filterNotifications,
  markAllRead,
  notificationCounts,
  restoreOne,
  setRead,
  type NotificationFilter,
} from '@shared/notification-actions.ts';
import type { AppNotification } from '@shared/portfolio.ts';
import { changeNotifications } from '@/data/mutations';
import { usePortfolio } from '@/data/usePortfolio';
import { colors } from '@/theme/tokens';
import { Badge, Button, Card, Chip, EmptyState, Header, Loading, Muted, Notice, Screen, styles } from '@/ui/kit';

const FILTERS: { key: NotificationFilter; label: string }[] = [
  { key: 'inbox', label: 'Inbox' },
  { key: 'unread', label: 'Unread' },
  { key: 'cleared', label: 'Cleared' },
  { key: 'all', label: 'History' },
];

const EMPTY: Record<NotificationFilter, { title: string; body: string }> = {
  inbox: { title: "You're all caught up", body: 'Dividend announcements and recorded payouts show up here.' },
  unread: { title: "You're all caught up", body: 'Nothing is waiting to be read.' },
  cleared: { title: 'Nothing cleared yet', body: 'Alerts you clear stay here, so you can find them again.' },
  all: { title: 'No alerts yet', body: 'Dividends recorded from PSX announcements and new payout news for your holdings appear here.' },
};

export default function Alerts() {
  const p = usePortfolio();
  const [filter, setFilter] = useState<NotificationFilter>('inbox');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = useMemo(() => p.portfolio?.notifications ?? [], [p.portfolio]);
  const counts = useMemo(() => notificationCounts(list), [list]);
  const items = useMemo(() => filterNotifications(list, filter), [list, filter]);
  const tickers = useMemo(() => new Set((p.portfolio?.companies ?? []).map((c) => c.ticker)), [p.portfolio]);

  if (p.isLoading)
    return (
      <Screen>
        <Loading />
      </Screen>
    );

  /** Saves a change to the notification list through the revisioned PUT. */
  async function apply(change: (l: AppNotification[]) => AppNotification[]) {
    if (!p.portfolio || busy) return;
    setBusy(true);
    setError(null);
    try {
      await p.save(changeNotifications(p.portfolio, change));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update your alerts.');
    } finally {
      setBusy(false);
    }
  }
  const confirmDelete = () =>
    Alert.alert(
      'Delete cleared alerts?',
      `${counts.cleared} cleared alert${counts.cleared === 1 ? '' : 's'} will be removed for good. This can't be undone.`,
      [
        { text: 'Keep them', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => void apply(deleteCleared) },
      ],
    );

  return (
    <Screen onRefresh={() => void p.refetch()} refreshing={p.isRefetching}>
      <Header title="Alerts" subtitle={counts.unread ? `${counts.unread} new` : undefined} />
      {p.error && !p.portfolio ? <Notice tone="error">{p.error.message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} accessibilityRole="tablist">
        {FILTERS.map((f) => (
          <Chip key={f.key} role="tab" label={`${f.label} ${counts[f.key]}`} selected={filter === f.key} onPress={() => setFilter(f.key)} />
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Button label="Mark all read" variant="secondary" disabled={busy || !counts.unread} onPress={() => void apply(markAllRead)} style={{ flexGrow: 1 }} />
        {filter === 'cleared' ? (
          <Button label="Delete cleared" variant="danger" disabled={busy || !counts.cleared} onPress={confirmDelete} style={{ flexGrow: 1 }} />
        ) : (
          <Button
            label="Clear all"
            variant="secondary"
            disabled={busy || !counts.inbox}
            onPress={() => void apply((l) => clearAll(l, new Date().toISOString()))}
            style={{ flexGrow: 1 }}
          />
        )}
      </View>

      {items.length === 0 ? <EmptyState icon="bell" title={EMPTY[filter].title} body={EMPTY[filter].body} /> : null}
      {items.map((n) => {
        const cleared = Boolean(n.clearedAt);
        const unread = !n.read && !cleared;
        const expected = p.portfolio ? expectedDividendFor(p.portfolio, n) : null;
        return (
          <Card key={n.id} style={unread ? { borderColor: 'rgba(59,130,246,0.45)' } : undefined}>
            <View style={styles.row}>
              <Text style={[styles.strong, { flex: 1 }]}>{n.title}</Text>
              {unread ? <Badge text="New" tone="primary" /> : null}
              {cleared ? <Badge text="Cleared" /> : null}
            </View>
            {n.body ? <Text style={{ color: colors.foreground, fontSize: 14, lineHeight: 20 }}>{n.body}</Text> : null}
            <Muted>
              {n.ticker ? `${n.ticker} · ` : ''}
              {new Date(n.at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
            </Muted>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {expected ? (
                <Button label="Mark received" icon="check" onPress={() => router.push({ pathname: '/received', params: { id: expected.id } })} style={{ minHeight: 44 }} />
              ) : null}
              {n.ticker && tickers.has(n.ticker) ? (
                <Button label={`Open ${n.ticker}`} variant="secondary" onPress={() => router.push({ pathname: '/company/[ticker]', params: { ticker: n.ticker! } })} style={{ minHeight: 44 }} />
              ) : null}
              {cleared ? (
                <Button label="Restore" variant="secondary" disabled={busy} onPress={() => void apply((l) => restoreOne(l, n.id))} style={{ minHeight: 44 }} />
              ) : (
                <>
                  <Button
                    label={n.read ? 'Mark unread' : 'Mark read'}
                    variant="secondary"
                    disabled={busy}
                    onPress={() => void apply((l) => setRead(l, n.id, !n.read))}
                    style={{ minHeight: 44 }}
                  />
                  <Button
                    label="Clear"
                    variant="ghost"
                    disabled={busy}
                    onPress={() => void apply((l) => clearOne(l, n.id, new Date().toISOString()))}
                    style={{ minHeight: 44 }}
                  />
                </>
              )}
            </View>
          </Card>
        );
      })}
    </Screen>
  );
}
