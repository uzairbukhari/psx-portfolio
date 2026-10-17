import { Text, View } from 'react-native';
import { valueCurrency, type CurrencyAsset } from '@shared/currency.ts';
import type { FxRateRow } from '@shared/fx-rates.ts';
import { money, moneyShort, today } from '@shared/portfolio.ts';
import { shortDate, signedMoney } from '@/data/format';
import { Amount, Muted, Notice, SectionHeader, StatusChip, useKitStyles } from './kit';

export type OwnedCurrency = { asset: CurrencyAsset; portfolioName?: string };

/** Foreign currency holdings valued in rupees. Read-only on the phone for now; add and sell on the web. */
export function ForeignCurrency({ owned, rates, ratesError }: { owned: OwnedCurrency[]; rates: FxRateRow[]; ratesError: string }) {
  const styles = useKitStyles();
  const asOf = today();
  if (!owned.length) return null;
  const values = owned.map(({ asset }) => valueCurrency(asset, rates, asOf));
  const total = values.reduce((n, v) => n + (v.value ?? 0), 0);
  const unpriced = values.some((v) => v.value === null);
  return (
    <>
      <SectionHeader title="Foreign currency" count={owned.length} value={unpriced ? null : moneyShort(total)} />
      {ratesError ? <Notice tone="warn">Could not load today&apos;s rates: {ratesError}</Notice> : null}
      <View style={[styles.card, { padding: 0, overflow: 'hidden' }]}>
        {owned.map(({ asset, portfolioName }, i) => {
          const v = values[i];
          return (
            <View
              key={`${asset.id}-${portfolioName ?? ''}`}
              accessible
              accessibilityLabel={`${asset.name}, ${v.units} ${asset.currency}, ${v.value === null ? 'rate needed' : moneyShort(v.value)}`}
              style={[{ padding: 14, gap: 8 }, i > 0 && { borderTopWidth: 1 }]}
            >
              <View style={styles.row}>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={styles.strong}>{asset.name}</Text>
                  <Text style={styles.muted}>{v.units} {asset.currency}</Text>
                  {portfolioName ? <StatusChip text={portfolioName} /> : null}
                </View>
                <View style={{ alignItems: 'flex-end', gap: 2 }}>
                  <Text style={styles.number}>{v.value === null ? 'Rate needed' : moneyShort(v.value)}</Text>
                  {v.gain === null ? <Muted>{v.cost === null ? 'cost not known' : ''}</Muted> : <Amount value={v.gain} text={signedMoney(v.gain)} size={13} label="Unrealised" />}
                </View>
              </View>
              {v.rate ? <Muted>Rate: {money(v.rate.pkrPerUnit)} per {asset.currency} · {v.rate.kind === 'open_market' ? 'open market' : 'interbank estimate'} · {shortDate(v.rate.date)}</Muted> : null}
            </View>
          );
        })}
      </View>
    </>
  );
}
