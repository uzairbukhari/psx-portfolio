import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { accountOverview, type AssetClassKey } from '@shared/account-overview.ts';
import { moneyShort, today, type DisplayPart } from '@shared/portfolio.ts';
import { signedMoney, signedPercent } from '@/data/format';
import { useTheme } from '@/theme/ThemeProvider';
import { Amount, Avatar, Card, ListRow, Notice, SectionLabel, useKitStyles } from './kit';

const CLASS_COLORS: Record<AssetClassKey, string> = {
  stocks: '#3987e5',
  gold: '#c98500',
  silver: '#9aa7b8',
  plans: '#199e70',
  funds: '#9085e9',
};

/** The All portfolios dashboard on the phone: net worth, asset mix, each portfolio and the largest holdings. */
export function AccountOverview({ parts, onOpenPortfolio }: { parts: (DisplayPart & { locked?: boolean })[]; onOpenPortfolio: (id: string) => void }) {
  const styles = useKitStyles();
  const { colors } = useTheme();
  const o = accountOverview(parts, today());
  const { total, returns, income } = o;
  return (
    <>
      <Card tone="hero" accessibilityLabel={`Net worth ${moneyShort(total.value)} across ${o.portfolios.length} portfolios`}>
        <Text style={styles.statLabel}>Net worth · all portfolios</Text>
        <Text style={[styles.title, { marginTop: 4 }]}>{moneyShort(total.value)}</Text>
        {total.gain !== null ? (
          <Amount value={total.gain} text={`${signedMoney(total.gain)}${total.gainPercent === null ? '' : ` (${signedPercent(total.gainPercent)})`}`} label="Unrealised" />
        ) : (
          <Text style={styles.muted}>Gain not yet known</Text>
        )}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginTop: 12 }}>
          <View>
            <Text style={styles.statLabel}>Invested</Text>
            <Text style={styles.number}>{total.cost === null ? '—' : moneyShort(total.cost)}</Text>
          </View>
          <View>
            <Text style={styles.statLabel}>Yearly return</Text>
            <Text style={styles.number}>{returns.rate === null ? '—' : signedPercent(returns.rate * 100)}</Text>
          </View>
          <View>
            <Text style={styles.statLabel}>Dividends {income.taxYear}</Text>
            <Text style={styles.number}>{moneyShort(income.received)}</Text>
          </View>
        </View>
        <Text style={[styles.muted, { marginTop: 8 }]}>
          {returns.rate !== null ? 'Return counts dividends received.' : (returns.blockedBy ?? 'Return shows after 90 days of history.')}
        </Text>
      </Card>
      {total.incomplete.length ? <Notice tone="warn">{total.incomplete.join(' ')}</Notice> : null}

      <SectionLabel>Where your money is</SectionLabel>
      <Card>
        <View style={{ flexDirection: 'row', height: 12, borderRadius: 6, overflow: 'hidden', backgroundColor: colors.line }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {o.classes.map((c) => (
            <View key={c.key} style={{ flex: Math.max(c.share, 0.5), backgroundColor: CLASS_COLORS[c.key] }} />
          ))}
        </View>
        {o.classes.map((c) => (
          <View key={c.key} style={[styles.row, { marginTop: 10 }]} accessible accessibilityLabel={`${c.label}, ${moneyShort(c.value)}, ${c.share.toFixed(1)} percent`}>
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

      <SectionLabel>Portfolios</SectionLabel>
      <View style={[styles.card, { padding: 0, overflow: 'hidden' }]}>
        {o.portfolios.map((p, i) => (
          <ListRow
            key={p.id}
            title={p.name}
            subtitle={`${p.heldCount} ${p.heldCount === 1 ? 'holding' : 'holdings'} · ${p.share.toFixed(1)}% of net worth${p.locked ? ' · locked' : ''}`}
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

      {o.topHoldings.length ? (
        <>
          <SectionLabel>Largest holdings</SectionLabel>
          <View style={[styles.card, { padding: 0, overflow: 'hidden' }]}>
            {o.topHoldings.slice(0, 5).map((h, i, list) => (
              <ListRow
                key={h.ticker}
                left={<Avatar ticker={h.ticker} />}
                title={h.ticker}
                subtitle={`${h.name} · ${h.portfolios.length > 1 ? `in ${h.portfolios.length} portfolios` : h.portfolios[0]}`}
                right={
                  <View style={{ alignItems: 'flex-end', gap: 2 }}>
                    <Text style={styles.number}>{moneyShort(h.value)}</Text>
                    <Text style={styles.muted}>{h.share.toFixed(1)}%</Text>
                  </View>
                }
                accessibilityLabel={`${h.ticker}, ${moneyShort(h.value)}, ${h.share.toFixed(1)} percent of net worth`}
                accessibilityHint="Opens the company"
                onPress={() => router.push({ pathname: '/company/[ticker]', params: { ticker: h.ticker } })}
                last={i === list.length - 1}
              />
            ))}
          </View>
        </>
      ) : null}
    </>
  );
}
