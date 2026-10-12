import { Text, View } from 'react-native';
import type { AccountOverview as Overview, AssetClassKey } from '@shared/account-overview.ts';
import { moneyShort } from '@shared/portfolio.ts';
import { signedMoney, signedPercent } from '@/data/format';
import { useTheme } from '@/theme/ThemeProvider';
import { Amount, Card, Fact, ListRow, Notice, SectionLabel, StatusChip, useKitStyles } from './kit';

const CLASS_COLORS: Record<AssetClassKey, string> = {
  stocks: '#3987e5',
  gold: '#c98500',
  silver: '#9aa7b8',
  plans: '#199e70',
  funds: '#9085e9',
};

/** Net worth of the selected portfolio (or all of them): value, gain, money in, yearly return and dividends. */
export function OverviewHero({ o, label }: { o: Overview; label: string }) {
  const styles = useKitStyles();
  const { total, returns, income } = o;
  return (
    <>
      <Card tone="hero" accessibilityLabel={`${label} ${moneyShort(total.value)}`}>
        <Text style={styles.sectionLabel}>{label}</Text>
        <Text style={[styles.title, { fontSize: 34, lineHeight: 40 }]}>{moneyShort(total.value)}</Text>
        {total.gain !== null ? (
          <Amount value={total.gain} text={`${signedMoney(total.gain)}${total.gainPercent === null ? '' : ` (${signedPercent(total.gainPercent)})`}`} label="Unrealised" size={16} weight="700" />
        ) : (
          <Text style={styles.muted}>Gain not yet known</Text>
        )}
        <View style={styles.divider} />
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Fact label="Invested" value={total.cost === null ? '—' : moneyShort(total.cost)} />
          <Fact label="Yearly return" value={returns.rate === null ? '—' : signedPercent(returns.rate * 100)} />
          <Fact label={`Dividends ${income.taxYear}`} value={moneyShort(income.received)} />
        </View>
        <Text style={styles.muted}>{returns.rate !== null ? 'Return counts dividends received.' : (returns.blockedBy ?? 'Return shows after 90 days of history.')}</Text>
      </Card>
      {total.incomplete.length ? <Notice tone="warn">{total.incomplete.join(' ')}</Notice> : null}
    </>
  );
}

/** Where the money is, by kind: a split bar and one line per kind. Shown only when there is more than one kind. */
export function AssetMix({ o }: { o: Overview }) {
  const styles = useKitStyles();
  const { colors } = useTheme();
  if (o.classes.length < 2) return null;
  return (
    <Card>
      <Text style={styles.sectionLabel}>Where your money is</Text>
      <View style={{ flexDirection: 'row', height: 12, borderRadius: 6, overflow: 'hidden', backgroundColor: colors.line }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {o.classes.map((c) => (
          <View key={c.key} style={{ flex: Math.max(c.share, 0.5), backgroundColor: CLASS_COLORS[c.key] }} />
        ))}
      </View>
      {o.classes.map((c) => (
        <View key={c.key} style={styles.row} accessible accessibilityLabel={`${c.label}, ${moneyShort(c.value)}, ${c.share.toFixed(1)} percent`}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 }}>
            <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: CLASS_COLORS[c.key] }} />
            <Text style={styles.text}>{c.label}</Text>
          </View>
          <Text style={styles.number}>
            {moneyShort(c.value)} · {c.share.toFixed(1)}%
          </Text>
        </View>
      ))}
    </Card>
  );
}

/** One line per portfolio with its value and share of net worth; tapping opens it. Only for the All view. */
export function PortfolioBreakdown({ o, onOpenPortfolio }: { o: Overview; onOpenPortfolio: (id: string) => void }) {
  const styles = useKitStyles();
  if (o.portfolios.length < 2) return null;
  return (
    <>
      <SectionLabel>Portfolios</SectionLabel>
      <View style={[styles.card, { padding: 0, overflow: 'hidden' }]}>
        {o.portfolios.map((p, i) => (
          <ListRow
            key={p.id}
            title={p.name}
            subtitle={`${p.share.toFixed(1)}% of net worth`}
            footer={p.locked ? <StatusChip text="Locked" tone="warn" icon="lock" /> : undefined}
            right={
              <View style={{ alignItems: 'flex-end', gap: 2 }}>
                <Text style={styles.number}>{moneyShort(p.value)}</Text>
                {p.gain === null ? null : <Amount value={p.gain} text={signedMoney(p.gain)} size={13} label="Unrealised" />}
              </View>
            }
            accessibilityLabel={`${p.name}, ${moneyShort(p.value)}, ${p.share.toFixed(1)} percent of net worth`}
            accessibilityHint="Opens this portfolio"
            onPress={() => onOpenPortfolio(p.id)}
            last={i === o.portfolios.length - 1}
          />
        ))}
      </View>
    </>
  );
}
