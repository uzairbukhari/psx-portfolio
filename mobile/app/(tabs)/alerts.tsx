import { useMemo } from 'react';
import { Text, View } from 'react-native';
import { activeNotifications } from '@/data/derive';
import { usePortfolio } from '@/data/usePortfolio';
import { colors } from '@/theme/tokens';
import { Badge, Card, EmptyState, Header, Loading, Muted, Notice, Screen, styles } from '@/ui/kit';

export default function Alerts() {
  const p = usePortfolio();
  const items = useMemo(() => (p.portfolio ? activeNotifications(p.portfolio) : []), [p.portfolio]);
  if (p.isLoading)
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  const unread = items.filter((n) => !n.read).length;
  return (
    <Screen onRefresh={() => void p.refetch()} refreshing={p.isRefetching}>
      <Header title="Alerts" subtitle={unread ? `${unread} new` : undefined} />
      {p.error && !p.portfolio ? <Notice tone="error">{p.error.message}</Notice> : null}
      {items.length === 0 ? (
        <EmptyState icon="bell" title="You're all caught up" body="Dividend announcements and recorded payouts show up here." />
      ) : null}
      {items.map((n) => (
        <Card key={n.id} style={!n.read ? { borderColor: 'rgba(59,130,246,0.45)' } : undefined}>
          <View style={styles.row}>
            <Text style={[styles.strong, { flex: 1 }]}>{n.title}</Text>
            {!n.read ? <Badge text="New" tone="primary" /> : null}
          </View>
          {n.body ? <Text style={{ color: colors.foreground, fontSize: 14, lineHeight: 20 }}>{n.body}</Text> : null}
          <Muted>{new Date(n.at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</Muted>
        </Card>
      ))}
    </Screen>
  );
}
