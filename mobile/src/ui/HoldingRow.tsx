// Holdings row, v2. Same data as src/ui/HoldingRow.tsx, tighter and calmer:
//   line 1  ticker (+ status dot)                      value
//   line 2  company name                               ▲ +Rs 1,234  +5.3 %   (one pill, one colour)
//   line 3  ▬▬▬▬▬▬▬▬░░░░  8.4 %  · 120 sh · avg Rs 300.12
// - memo with a field-level comparison: a refetch that rebuilds holdings objects does not re-render unchanged rows.
// - onPress takes the ticker, so the list passes one stable callback instead of a new closure per row.
// - A price change flashes the row in the gain/loss tint (native driver) so live updates are noticed, not jarring.
// - The weight bar gives every row a visual size cue, so the list reads as a portfolio, not a ledger.
// - No chevron: the whole row is the target (Material list convention), which buys 28 dp for the figures.
import { memo, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { money, moneyShort } from '@shared/portfolio.ts';
import { signedAmountLabel, signedPercentLabel } from '@/data/a11y';
import { signedMoney, signedPercent } from '@/data/format';
import { useTheme } from '@/theme/ThemeProvider';
import { radii, type } from '@/theme/tokens';
import { Icon } from './Icon';
import { Avatar } from './kit';
import { useChangePulse, usePressScale, useReduceMotion } from './motion';

/** The fields of derive.ts#Holding this row reads. */
export type HoldingRowData = {
  ticker: string;
  name: string;
  shares: number;
  average: number | null;
  value: number | null;
  gain: number | null;
  cost: number | null;
  quote?: { date: string } | null;
};

const shares = new Intl.NumberFormat('en-PK');

type Props = {
  h: HoldingRowData;
  /** Share of the list's total value, 0 to 100 (null when the value is unknown). */
  weight: number | null;
  flags?: { stale?: boolean; expectedDividend?: boolean };
  onPress: (ticker: string) => void;
  last?: boolean;
};

function HoldingRowV2({ h, weight, flags, onPress, last }: Props) {
  const { colors } = useTheme();
  const reduce = useReduceMotion();
  const press = usePressScale(0.985, reduce);

  const gainPct = h.gain === null || !h.cost ? null : (h.gain / h.cost) * 100;
  const tone = h.gain === null || h.gain === 0 ? colors.muted : h.gain > 0 ? colors.gain : colors.loss;
  const soft = h.gain === null || h.gain === 0 ? colors.raised : h.gain > 0 ? colors.gainSoft : colors.lossSoft;
  const stale = Boolean(flags?.stale && h.quote);
  const status = h.value === null ? { text: 'No price', color: colors.warn } : stale ? { text: `Price ${h.quote!.date}`, color: colors.warn } : flags?.expectedDividend ? { text: 'Dividend due', color: colors.primary } : null;

  // Flash on a value change: tint toward gain or loss depending on the direction of the move.
  // Derived state (React's "store the previous prop" pattern), so no ref is written during render.
  const [seen, setSeen] = useState({ value: h.value, up: true });
  if (seen.value !== h.value) setSeen({ value: h.value, up: h.value === null || seen.value === null || h.value >= seen.value });
  const up = seen.up;
  const flash = useChangePulse(h.value, { duration: 700, reduce });

  const spoken = [
    h.ticker,
    h.name,
    h.value === null ? 'no price yet' : `value ${moneyShort(h.value)}`,
    h.gain === null ? '' : `unrealised ${signedAmountLabel(h.gain)}${gainPct === null ? '' : `, ${signedPercentLabel(gainPct)}`}`,
    weight === null ? '' : `${weight.toFixed(1)} percent of holdings`,
    `${shares.format(h.shares)} shares`,
    h.average === null ? '' : `average cost ${money(h.average)}`,
    status?.text ?? '',
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Pressable accessibilityRole="button" accessibilityLabel={spoken} accessibilityHint="Opens the company" onPress={() => onPress(h.ticker)} {...press.handlers}>
      {({ pressed }) => (
        <Animated.View
          style={[
            press.style,
            styles.row,
            { backgroundColor: pressed ? colors.raised : colors.surface },
            !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
          ]}
        >
          <Animated.View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, { backgroundColor: up ? colors.gainSoft : colors.lossSoft, opacity: flash.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0] }) }]}
          />
          <Avatar ticker={h.ticker} />
          <View style={{ flex: 1, gap: 2 }}>
            <View style={styles.line}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}>
                <Text numberOfLines={1} style={{ color: colors.ink, ...type.headline, flexShrink: 1 }}>
                  {h.ticker}
                </Text>
                {status ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: status.color }} /> : null}
              </View>
              <Text style={{ color: colors.ink, ...type.number }}>{h.value === null ? '—' : moneyShort(h.value)}</Text>
            </View>
            <View style={styles.line}>
              <Text numberOfLines={1} style={{ color: colors.muted, ...type.caption, flex: 1 }}>
                {status ? `${status.text} · ${h.name}` : h.name}
              </Text>
              {h.gain === null ? null : (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: soft, borderRadius: radii.pill, paddingHorizontal: 6, paddingVertical: 1 }}>
                  {h.gain !== 0 ? <Icon name={h.gain > 0 ? 'arrowUp' : 'arrowDown'} size={11} color={tone} strokeWidth={2.8} /> : null}
                  <Text style={{ color: tone, ...type.number, fontSize: 12, lineHeight: 16 }}>
                    {signedMoney(h.gain)}
                    {gainPct === null ? '' : `  ${signedPercent(gainPct)}`}
                  </Text>
                </View>
              )}
            </View>
            <View style={[styles.line, { gap: 8, marginTop: 4 }]}>
              {weight !== null ? (
                <View style={{ width: 56, height: 4, borderRadius: 2, backgroundColor: colors.raised, overflow: 'hidden' }}>
                  <View style={{ height: 4, width: '100%', backgroundColor: colors.primary, transformOrigin: 'left', transform: [{ scaleX: Math.max(0.03, Math.min(1, weight / 100)) }] }} />
                </View>
              ) : null}
              <Text numberOfLines={1} style={{ color: colors.muted, ...type.caption, fontSize: 12, lineHeight: 16, flex: 1, fontVariant: ['tabular-nums'] }}>
                {weight === null ? '' : `${weight.toFixed(1)}% · `}
                {shares.format(h.shares)} sh · avg {h.average === null ? '—' : money(h.average)}
              </Text>
            </View>
          </View>
        </Animated.View>
      )}
    </Pressable>
  );
}

const same = (a: Props, b: Props) =>
  a.h.ticker === b.h.ticker &&
  a.h.name === b.h.name &&
  a.h.shares === b.h.shares &&
  a.h.average === b.h.average &&
  a.h.value === b.h.value &&
  a.h.gain === b.h.gain &&
  a.h.cost === b.h.cost &&
  a.h.quote?.date === b.h.quote?.date &&
  a.weight === b.weight &&
  a.flags?.stale === b.flags?.stale &&
  a.flags?.expectedDividend === b.flags?.expectedDividend &&
  a.last === b.last &&
  a.onPress === b.onPress;

export const HoldingRow = memo(HoldingRowV2, same);

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12, minHeight: 72, overflow: 'hidden' },
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
});

// Usage in app/(tabs)/portfolio.tsx (replaces the inline map):
//
//   const openCompany = useCallback((ticker: string) => router.push({ pathname: '/company/[ticker]', params: { ticker } }), []);
//   const total = useMemo(() => open.reduce((a, h) => a + (h.value ?? 0), 0), [open]);
//   ...
//   {shown.map((h, i) => (
//     <HoldingRow key={h.ticker} h={h} weight={h.value === null || !total ? null : (h.value / total) * 100}
//       flags={flags.get(h.ticker)} onPress={openCompany} last={i === shown.length - 1} />
//   ))}
