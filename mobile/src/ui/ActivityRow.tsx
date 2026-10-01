import { Text } from 'react-native';
import { money } from '@shared/portfolio.ts';
import type { ActivityEntry } from '@/data/derive';
import { useTheme } from '@/theme/ThemeProvider';
import { type } from '@/theme/tokens';
import { Avatar, ListRow } from '@/ui/kit';

const SIGN: Record<ActivityEntry['kind'], string> = { buy: '−', opening: '', sell: '+', dividend: '+', split: '' };

/**
 * One ledger line. Put several inside a padding-less Card; `last` drops the final divider. The amount is the
 * cash effect: money out for buys (−), money in for sales and dividends (+), so colour is not the only cue.
 */
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
  const { colors } = useTheme();
  const tone: Record<ActivityEntry['kind'], string> = {
    buy: colors.ink,
    opening: colors.ink,
    sell: colors.gain,
    dividend: colors.gain,
    split: colors.muted,
  };
  return (
    <ListRow
      left={showTicker ? <Avatar ticker={entry.ticker} size={40} /> : undefined}
      title={`${showTicker ? `${entry.ticker} · ` : ''}${entry.title}`}
      subtitle={`${entry.date}${entry.detail ? ` · ${entry.detail}` : ''}`}
      wrapTitle
      right={
        entry.amount !== null ? (
          <Text style={{ color: tone[entry.kind], ...type.number }}>
            {SIGN[entry.kind]}
            {money(entry.amount)}
          </Text>
        ) : undefined
      }
      accessibilityLabel={[
        showTicker ? entry.ticker : '',
        entry.title,
        entry.date,
        entry.detail,
        entry.amount !== null ? `${entry.kind === 'buy' ? 'paid' : entry.kind === 'sell' || entry.kind === 'dividend' ? 'received' : 'amount'} ${money(entry.amount)}` : '',
      ]
        .filter(Boolean)
        .join(', ')}
      accessibilityHint={onPress ? (showTicker ? 'Opens the company' : 'Opens this entry to correct or void it') : undefined}
      onPress={onPress}
      last={last}
    />
  );
}
