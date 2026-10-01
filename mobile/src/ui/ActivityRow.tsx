import { Text, View } from 'react-native';
import { money } from '@shared/portfolio.ts';
import type { ActivityEntry } from '@/data/derive';
import { colors } from '@/theme/tokens';
import { Muted, styles } from '@/ui/kit';

const tone: Record<ActivityEntry['kind'], string> = {
  buy: colors.foreground,
  opening: colors.foreground,
  sell: colors.danger,
  dividend: colors.success,
  split: colors.muted,
};

export function ActivityRow({ entry, showTicker = true }: { entry: ActivityEntry; showTicker?: boolean }) {
  return (
    <View style={[styles.row, { paddingVertical: 12 }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: tone[entry.kind], fontSize: 15, fontWeight: '600' }}>
          {showTicker ? `${entry.ticker} · ` : ''}
          {entry.title}
        </Text>
        <Muted>
          {entry.date}
          {entry.detail ? ` · ${entry.detail}` : ''}
        </Muted>
      </View>
      {entry.amount !== null ? <Text style={styles.strong}>{money(entry.amount)}</Text> : null}
    </View>
  );
}
