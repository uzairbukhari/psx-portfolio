import { Text, View } from 'react-native';
import { describePieces, valueMetal, type MetalAsset } from '@shared/assets.ts';
import { tolaFromGrams, type MetalRateRow } from '@shared/metal-rates.ts';
import { money, moneyShort, today } from '@shared/portfolio.ts';
import { shortDate, signedMoney } from '@/data/format';
import { useTheme } from '@/theme/ThemeProvider';
import { Amount, Fact, Muted, Notice, SectionHeader, StatusChip, useKitStyles } from './kit';

export type OwnedMetal = { asset: MetalAsset; portfolioName?: string };

/** Gold and silver coins and bars with their recent history. Read-only on the phone for now; add and sell on the web. */
export function GoldSilver({ owned, rates, ratesError }: { owned: OwnedMetal[]; rates: MetalRateRow[]; ratesError: string }) {
  const styles = useKitStyles();
  const { colors } = useTheme();
  const asOf = today();
  if (!owned.length) return null;
  const values = owned.map(({ asset }) => valueMetal(asset, rates, asOf));
  const total = values.reduce((n, v) => n + (v.value ?? 0), 0);
  const unpriced = values.some((v) => v.value === null);
  return (
    <>
      <SectionHeader title="Gold and silver" count={owned.length} value={unpriced ? null : moneyShort(total)} />
      {ratesError ? <Notice tone="warn">Could not load today&apos;s rates: {ratesError}</Notice> : null}
      <View style={[styles.card, { padding: 0, overflow: 'hidden' }]}>
        {owned.map(({ asset, portfolioName }, i) => {
          const v = values[i];
          const recent = [...v.history].reverse().slice(0, 3);
          return (
            <View
              key={`${asset.id}-${portfolioName ?? ''}`}
              accessible
              accessibilityLabel={`${asset.name}, ${v.grams} grams, ${v.value === null ? 'rate needed' : moneyShort(v.value)}`}
              style={[{ padding: 14, gap: 12 }, i > 0 && { borderTopWidth: 1, borderTopColor: colors.line }]}
            >
              <View style={styles.row}>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={styles.strong}>{asset.name}</Text>
                  <Text style={styles.muted}>{v.grams} g · {tolaFromGrams(v.grams).toFixed(2)} tola</Text>
                  {portfolioName ? <StatusChip text={portfolioName} /> : null}
                </View>
                <View style={{ alignItems: 'flex-end', gap: 2 }}>
                  <Text style={styles.number}>{v.value === null ? 'Rate needed' : moneyShort(v.value)}</Text>
                  {v.gain === null ? <Muted>{v.cost === null ? 'cost not known' : ''}</Muted> : <Amount value={v.gain} text={signedMoney(v.gain)} size={13} label="Unrealised" />}
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <Fact label="Bought" value={`${v.bought.grams} g`} />
                <Fact label="Sold" value={`${v.sold.grams} g`} />
                <Fact label="Realised" value={v.realized === null ? '—' : signedMoney(v.realized)} />
              </View>
              {recent.length ? (
                <View style={{ gap: 6 }}>
                  {recent.map((e) => (
                    <View key={e.id} style={styles.row} accessible accessibilityLabel={`${e.type === 'sell' ? 'Sold' : 'Bought'} ${describePieces(e)} on ${shortDate(e.date)}`}>
                      <Text style={[styles.muted, { flexShrink: 1 }]}>
                        {shortDate(e.date)} · {e.type === 'opening' ? 'Opening' : e.type === 'buy' ? 'Bought' : 'Sold'} {describePieces(e)}
                      </Text>
                      <Text style={styles.muted}>{e.amount === null ? 'cost unknown' : money(e.amount)}</Text>
                    </View>
                  ))}
                  {v.history.length > recent.length ? <Muted>Older entries are in the web app.</Muted> : null}
                </View>
              ) : null}
              {v.rate ? <Muted>Rate: {money(v.rate.pkrPerTola)} per tola · {v.rate.kind === 'local' ? 'dealer' : 'international estimate'} · {shortDate(v.rate.date)}</Muted> : null}
            </View>
          );
        })}
      </View>
    </>
  );
}
