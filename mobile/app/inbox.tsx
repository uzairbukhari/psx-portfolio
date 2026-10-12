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
import { useTheme } from '@/theme/ThemeProvider';
import { Icon } from '@/ui/Icon';
import { Avatar, Button, Chip, ChipRow, EmptyState, Loading, Notice, Screen, useKitStyles } from '@/ui/kit';

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

/** The Inbox (the bell): dividend announcements and recorded payouts, with read, clear, restore and history like the web. */
export default function Inbox() {
  const p = usePortfolio();
  const styles = useKitStyles();
  const { colors } = useTheme();
  const [filter, setFilter] = useState<NotificationFilter>('inbox');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = useMemo(() => p.portfolio?.notifications ?? [], [p.portfolio]);
  const counts = useMemo(() => notificationCounts(list), [list]);
  const items = useMemo(() => filterNotifications(list, filter), [list, filter]);
  const tickers = useMemo(() => new Set((p.portfolio?.companies ?? []).map((c) => c.ticker)), [p.portfolio]);

  if (p.isLoading)
    return (
      <Screen edges={['bottom']}>
        <Loading cards={2} />
      </Screen>
    );

  /** Saves a change to the notification list through the revisioned PUT. */
  async function apply(change: (l: AppNotification[]) => AppNotification[]) {
    if (!p.portfolio || busy) return;
    setBusy(true);
    setError(null);
    try {
      await p.saveNotifications(changeNotifications(p.portfolio, change).notifications ?? []);
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

  const portfolioNames = (p.account?.portfolios ?? []).map((e) => e.name);
  /** "Arif Habib · OGDC dividend expected" becomes a title plus a portfolio label, so the title is not crowded. */
  function split(n: AppNotification): { title: string; from: string | null } {
    const from = portfolioNames.find((name) => n.title.startsWith(`${name} · `)) ?? null;
    return { title: from ? n.title.slice(from.length + 3) : n.title, from: portfolioNames.length > 1 ? from : null };
  }
  const disabled = busy || p.offline;

  return (
    <Screen edges={['bottom']} onRefresh={() => void p.refetch()} refreshing={p.isRefetching}>
      {p.error && !p.portfolio ? <Notice tone="error">{p.error.message}</Notice> : null}
      {p.offline ? <Notice tone="offline">Offline · showing your saved alerts. Changes are paused until you reconnect.</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      <ChipRow label="Alert lists">
        {FILTERS.map((f) => (
          <Chip key={f.key} role="tab" label={counts[f.key] ? `${f.label} · ${counts[f.key]}` : f.label} accessibilityLabel={`${f.label}, ${counts[f.key]}`} selected={filter === f.key} onPress={() => setFilter(f.key)} />
        ))}
      </ChipRow>

      {items.length ? (
        <View style={styles.row}>
          <Text style={styles.muted} accessibilityLiveRegion="polite">{counts.unread ? `${counts.unread} new` : 'Nothing new'}</Text>
          <View style={{ flexDirection: 'row', gap: 4 }}>
            {counts.unread ? <Button label="Mark all read" variant="text" disabled={disabled} onPress={() => void apply(markAllRead)} /> : null}
            {filter === 'cleared' ? (
              counts.cleared ? <Button label="Delete cleared" variant="text" disabled={disabled} onPress={confirmDelete} /> : null
            ) : counts.inbox ? (
              <Button label="Clear all" variant="text" disabled={disabled} onPress={() => void apply((l) => clearAll(l, new Date().toISOString()))} />
            ) : null}
          </View>
        </View>
      ) : null}

      {items.length === 0 ? <EmptyState icon="bell" title={EMPTY[filter].title} body={EMPTY[filter].body} /> : null}
      {items.length ? (
        <View style={[styles.card, { padding: 0, overflow: 'hidden' }]}>
          {items.map((n, i) => {
            const cleared = Boolean(n.clearedAt);
            const unread = !n.read && !cleared;
            const expected = p.portfolio ? expectedDividendFor(p.portfolio, n) : null;
            const { title, from } = split(n);
            const when = new Date(n.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
            const canOpen = Boolean(n.ticker && tickers.has(n.ticker));
            return (
              <View key={n.id} style={[{ padding: 14, gap: 8, flexDirection: 'row' }, i < items.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.line }, unread && { backgroundColor: colors.primarySoft }]}>
                {n.ticker ? <Avatar ticker={n.ticker} size={40} /> : (
                  <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="bell" size={18} color={colors.muted} />
                  </View>
                )}
                <View style={{ flex: 1, gap: 6 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                    <Text style={[styles.strong, { flex: 1 }]} accessibilityLabel={`${unread ? 'New. ' : ''}${title}`}>{title}</Text>
                    {unread ? <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary, marginTop: 6 }} /> : null}
                  </View>
                  {n.body ? <Text style={styles.text} numberOfLines={5}>{n.body}</Text> : null}
                  <Text style={styles.muted}>{[when, from, cleared ? 'Cleared' : null].filter(Boolean).join(' · ')}</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4, marginLeft: -8 }}>
                    {expected ? <Button label="Mark received" icon="check" variant="tonal" onPress={() => router.push({ pathname: '/received', params: { id: expected.id } })} /> : null}
                    {canOpen ? <Button label={`Open ${n.ticker}`} variant="text" onPress={() => router.push({ pathname: '/company/[ticker]', params: { ticker: n.ticker! } })} /> : null}
                    {cleared ? (
                      <Button label="Restore" variant="text" disabled={disabled} onPress={() => void apply((l) => restoreOne(l, n.id))} />
                    ) : (
                      <>
                        <Button label={n.read ? 'Mark unread' : 'Mark read'} variant="text" disabled={disabled} onPress={() => void apply((l) => setRead(l, n.id, !n.read))} />
                        <Button label="Clear" variant="text" disabled={disabled} onPress={() => void apply((l) => clearOne(l, n.id, new Date().toISOString()))} />
                      </>
                    )}
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      ) : null}
    </Screen>
  );
}
