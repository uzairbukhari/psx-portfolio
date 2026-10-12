import { Text, View } from 'react-native';
import { valueFund, type FundAsset } from '@shared/funds.ts';
import type { FundNavRow } from '@shared/mufap.ts';
import { moneyShort, today } from '@shared/portfolio.ts';
import { shortDate, signedMoney } from '@/data/format';
import { useTheme } from '@/theme/ThemeProvider';
import { Amount, Fact, Muted, Notice, SectionHeader, StatusChip, useKitStyles } from './kit';

export type OwnedFund = { asset: FundAsset; portfolioName?: string };

/** Mutual funds. Read-only on the phone for now; record changes on the web. */
export function MutualFunds({ owned, navs, navsError }: { owned: OwnedFund[]; navs: FundNavRow[]; navsError: string }) {
  const styles = useKitStyles();
  const { colors } = useTheme();
  const asOf = today();
  if (!owned.length) return null;
  const values = owned.map(({ asset }) => valueFund(asset, navs, asOf));
  const total = values.reduce((n, v) => n + (v.value ?? 0), 0);
  const unpriced = values.some((v) => v.value === null);
  return (
    <>
      <SectionHeader title="Mutual funds" count={owned.length} value={unpriced ? null : moneyShort(total)} />
      {navsError ? <Notice tone="warn">Could not load fund prices: {navsError}</Notice> : null}
      <View style={[styles.card, { padding: 0, overflow: 'hidden' }]}>
        {owned.map(({ asset, portfolioName }, i) => {
          const v = values[i];
          return (
            <View
              key={`${asset.id}-${portfolioName ?? ''}`}
              accessible
              accessibilityLabel={`${asset.name}, value ${v.value === null ? 'unknown' : moneyShort(v.value)}`}
              style={[{ padding: 14, gap: 12 }, i > 0 && { borderTopWidth: 1, borderTopColor: colors.line }]}
            >
              <View style={styles.row}>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={styles.strong}>{asset.name}</Text>
                  <Text style={styles.muted} numberOfLines={2}>{asset.amc}</Text>
                  {portfolioName ? <StatusChip text={portfolioName} /> : null}
                </View>
                <View style={{ alignItems: 'flex-end', gap: 2 }}>
                  <Text style={styles.number}>{v.value === null ? '—' : moneyShort(v.value)}</Text>
                  <Amount value={v.gain} text={signedMoney(v.gain)} size={13} label="Gain" />
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <Fact label="Units" value={String(Math.round(v.units * 1000) / 1000)} />
                <Fact label="Still in" value={v.cost === null ? 'Unknown' : moneyShort(v.cost)} />
                <Fact label="Price" value={v.price ? `Rs ${v.price.nav.toFixed(2)}` : '—'} />
              </View>
              <Muted>
                {v.price ? `Price from ${v.price.source === 'manual' ? 'your entry' : 'MUFAP'} on ${shortDate(v.price.date)}${v.price.stale ? ' (old)' : ''}.` : 'No price yet, so the value is unknown.'}
              </Muted>
            </View>
          );
        })}
      </View>
    </>
  );
}
