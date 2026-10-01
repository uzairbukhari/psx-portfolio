import { Text } from 'react-native';
import { money } from '@shared/portfolio.ts';
import type { ActivityEntry } from '@/data/derive';
import { colors } from '@/theme/tokens';
import { Avatar, ListRow } from '@/ui/kit';

const tone: Record<ActivityEntry['kind'], string> = {
  buy: colors.foreground,
  opening: colors.foreground,
  sell: colors.danger,
  dividend: colors.success,
  split: colors.muted,
};

/** One ledger line. Put several inside a padding-less Card; `last` drops the final divider. */
export function ActivityRow({
  entry,
  showTicker = true,
  onPress,
  last,
}: {
  entry: ActivityEntry;
  showTicker?: boolean;
  onPress?: () => void;
  last?: boolean;
}) {
  return (
    <ListRow
      left={showTicker ? <Avatar ticker={entry.ticker} size={36} /> : undefined}
      title={`${showTicker ? `${entry.ticker} · ` : ''}${entry.title}`}
      subtitle={`${entry.date}${entry.detail ? ` · ${entry.detail}` : ''}`}
      right={
        entry.amount !== null ? (
          <Text style={{ color: tone[entry.kind], fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] }}>{money(entry.amount)}</Text>
        ) : undefined
      }
      accessibilityLabel={[
        showTicker ? entry.ticker : '',
        entry.title,
        entry.date,
        entry.detail,
        entry.amount !== null ? `amount ${money(entry.amount)}` : '',
      ]
        .filter(Boolean)
        .join(', ')}
      accessibilityHint={onPress ? (showTicker ? 'Opens the company' : 'Opens this entry to correct or void it') : undefined}
      onPress={onPress}
      last={last}
    />
  );
}
