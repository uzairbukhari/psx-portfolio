import { Pressable, StyleSheet, Text, View } from 'react-native';
import { money, moneyShort } from '@shared/portfolio.ts';
import { signedAmountLabel, signedPercentLabel } from '@/data/a11y';
import type { Holding } from '@/data/derive';
import { signedMoney, signedPercent } from '@/data/format';
import { useTheme } from '@/theme/ThemeProvider';
import { Icon } from './Icon';
import { Amount, Avatar, StatusChip, useKitStyles } from './kit';

const fmt = new Intl.NumberFormat('en-PK');

/**
 * One company in the Stocks list. Two columns: the company on the left (ticker, name on one line, shares and average
 * cost), the value and gain on the right. The name is cut with an ellipsis instead of being squeezed into a narrow
 * column, so every row is the same height.
 */
export function HoldingRow({
  h,
  flags,
  weight,
  onPress,
  last,
}: {
  h: Holding;
  flags?: { stale?: boolean; expectedDividend?: boolean };
  /** Share of the portfolio's value, shown when the list is sorted by weight. */
  weight?: number | null;
  onPress: () => void;
  last?: boolean;
}) {
  const styles = useKitStyles();
  const { colors } = useTheme();
  const gainPct = h.gain === null || !h.cost ? null : (h.gain / h.cost) * 100;
  const stale = flags?.stale && h.quote;
  const label = [
    h.ticker,
    h.name,
    `${fmt.format(h.shares)} shares`,
    h.average === null ? '' : `average cost ${money(h.average)}`,
    h.value === null ? 'no price yet' : `value ${moneyShort(h.value)}`,
    h.gain === null ? '' : `unrealised ${signedAmountLabel(h.gain)}${gainPct === null ? '' : `, ${signedPercentLabel(gainPct)}`}`,
    stale ? `price from ${h.quote!.date}, stale` : '',
    flags?.expectedDividend ? 'dividend expected' : '',
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <Pressable
      accessible
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Opens the company"
      onPress={onPress}
      style={({ pressed }) => [styles.listRow, { alignItems: 'flex-start', paddingVertical: 12 }, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line }, pressed && { backgroundColor: colors.raised }]}
    >
      <Avatar ticker={h.ticker} />
      <View style={{ flex: 1, gap: 3 }}>
        <View style={styles.row}>
          <Text style={[styles.strong, { flexShrink: 1 }]} numberOfLines={1}>{h.ticker}</Text>
          <Text style={styles.number}>{h.value === null ? '—' : moneyShort(h.value)}</Text>
        </View>
        <View style={styles.row}>
          <Text style={[styles.muted, { flex: 1 }]} numberOfLines={1}>{h.name}</Text>
          {h.gain === null ? null : <Amount value={h.gain} text={signedMoney(h.gain)} size={13} />}
        </View>
        <View style={styles.row}>
          <Text style={[styles.muted, { flex: 1 }]} numberOfLines={1}>
            {fmt.format(h.shares)} sh · avg {h.average === null ? '—' : money(h.average)}
            {weight !== undefined && weight !== null ? ` · ${weight.toFixed(1)}% of value` : ''}
          </Text>
          {gainPct === null ? null : <Text style={[styles.muted, { color: gainPct > 0 ? colors.gain : gainPct < 0 ? colors.loss : colors.muted }]}>{signedPercent(gainPct)}</Text>}
        </View>
        {h.value === null || stale || flags?.expectedDividend ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 2 }}>
            {h.value === null ? <StatusChip tone="warn" text="No price" /> : stale ? <StatusChip tone="warn" text={`Stale price · ${h.quote!.date}`} /> : null}
            {flags?.expectedDividend ? <StatusChip tone="primary" text="Expected dividend" icon="inbox" /> : null}
          </View>
        ) : null}
      </View>
      <View style={{ alignSelf: 'center' }}>
        <Icon name="chevronRight" size={16} color={colors.muted} />
      </View>
    </Pressable>
  );
}
