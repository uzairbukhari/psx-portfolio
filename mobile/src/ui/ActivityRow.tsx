import { Pressable, StyleSheet, Text, View } from 'react-native';
import { money } from '@shared/portfolio.ts';
import type { ActivityEntry } from '@/data/derive';
import { shortDate } from '@/data/format';
import { useTheme } from '@/theme/ThemeProvider';
import { type } from '@/theme/tokens';
import { Icon } from './Icon';
import { Avatar, StatusChip, useKitStyles } from './kit';

const SIGN: Record<ActivityEntry['kind'], string> = { buy: '−', opening: '', adjustment: '', sell: '+', dividend: '+', split: '' };
const KIND_LABEL: Record<ActivityEntry['kind'], string> = { buy: 'Buy', opening: 'Opening', adjustment: 'Adjustment', sell: 'Sell', dividend: 'Dividend', split: 'Split' };

/** "Bought 25" becomes "25 shares"; the kind chip already says what happened. */
const quantity = (entry: ActivityEntry) => entry.title.replace(/^(Holding adjustment|Sold|Opening|Bought)\s*/, '').trim();

/**
 * One ledger line. Put several inside a padding-less Card; `last` drops the final divider. The amount is the
 * cash effect: money out for buys (−), money in for sales and dividends (+), so colour is not the only cue.
 * Layout: ticker and amount share the first line, the kind chip and quantity the second, date and detail the third,
 * so nothing is squeezed into a narrow column.
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
  const styles = useKitStyles();
  const tone: Record<ActivityEntry['kind'], string> = {
    buy: colors.ink,
    opening: colors.ink,
    adjustment: colors.muted,
    sell: colors.gain,
    dividend: colors.gain,
    split: colors.muted,
  };
  const expected = entry.kind === 'dividend' && entry.title.includes('expected');
  const qty = !showTicker || entry.kind === 'dividend' || entry.kind === 'split' ? '' : quantity(entry);
  const chip = (
    <StatusChip text={expected ? 'Dividend · expected' : KIND_LABEL[entry.kind]} tone={entry.kind === 'sell' || entry.kind === 'dividend' ? (expected ? 'warn' : 'success') : entry.kind === 'buy' || entry.kind === 'opening' ? 'primary' : 'neutral'} />
  );
  return (
    <Pressable
      accessible
      accessibilityRole={onPress ? 'button' : 'text'}
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
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [styles.listRow, { alignItems: 'flex-start', paddingVertical: 12 }, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line }, pressed && { backgroundColor: colors.raised }]}
    >
      {showTicker ? <Avatar ticker={entry.ticker} size={40} /> : null}
      <View style={{ flex: 1, gap: 4 }}>
        <View style={styles.row}>
          <Text style={[styles.strong, { flexShrink: 1 }]} numberOfLines={1}>{showTicker ? entry.ticker : entry.title}</Text>
          {entry.amount !== null ? (
            <Text style={{ color: tone[entry.kind], ...type.number }}>
              {SIGN[entry.kind]}
              {money(entry.amount)}
            </Text>
          ) : null}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {chip}
          {qty ? <Text style={styles.text}>{qty} shares</Text> : null}
        </View>
        <Text style={styles.muted} numberOfLines={2}>{shortDate(entry.date, new Date().getFullYear())} · {entry.detail}</Text>
      </View>
      {onPress ? <View style={{ alignSelf: 'center' }}><Icon name="chevronRight" size={16} color={colors.muted} /></View> : null}
    </Pressable>
  );
}
