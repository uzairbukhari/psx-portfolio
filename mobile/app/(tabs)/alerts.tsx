import { useMemo } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { activeNotifications } from '@/data/derive';
import { usePortfolio } from '@/data/usePortfolio';
import { colors } from '@/theme/tokens';
import { Card, Muted, Notice, Screen, Title, styles } from '@/ui/kit';

export default function Alerts() {
  const p = usePortfolio();
  const items = useMemo(() => (p.portfolio ? activeNotifications(p.portfolio) : []), [p.portfolio]);
  if (p.isLoading)
    return (
      <Screen>
        <ActivityIndicator color={colors.primary} style={{ marginTop: 60 }} />
      </Screen>
    );
  return (
    <Screen onRefresh={() => void p.refetch()} refreshing={p.isRefetching}>
      <Title>Alerts</Title>
      {p.error && !p.portfolio ? <Notice tone="error">{p.error.message}</Notice> : null}
      {items.length === 0 ? <Muted>Nothing new. Dividend announcements and recorded payouts show up here.</Muted> : null}
      {items.map((n) => (
        <Card key={n.id}>
          <View style={styles.row}>
            <Text style={[styles.strong, { flex: 1 }]}>{n.title}</Text>
            {!n.read ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary }} /> : null}
          </View>
          {n.body ? <Muted>{n.body}</Muted> : null}
          <Muted>{new Date(n.at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</Muted>
        </Card>
      ))}
    </Screen>
  );
}
