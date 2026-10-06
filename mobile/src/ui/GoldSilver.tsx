import { Text, View } from 'react-native';
import { describePieces, valueMetal, type MetalAsset } from '@shared/assets.ts';
import { tolaFromGrams, type MetalRateRow } from '@shared/metal-rates.ts';
import { money, moneyShort, today } from '@shared/portfolio.ts';
import { shortDate, signedMoney } from '@/data/format';
import { Amount, Card, Muted, Notice, SectionLabel, useKitStyles } from './kit';

export type OwnedMetal = { asset: MetalAsset; portfolioName?: string };

/** Gold and silver coins and bars with their full history. Read-only on the phone for now; add and sell on the web. */
export function GoldSilver({ owned, rates, ratesError }: { owned: OwnedMetal[]; rates: MetalRateRow[]; ratesError: string }) {
  const styles = useKitStyles();
  const asOf = today();
  if (!owned.length) return null;
  return (
    <>
      <SectionLabel>Gold and silver</SectionLabel>
      {ratesError ? <Notice tone="warn">Could not load today&apos;s rates: {ratesError}</Notice> : null}
      {owned.map(({ asset, portfolioName }) => {
        const v = valueMetal(asset, rates, asOf);
        const recent = [...v.history].reverse().slice(0, 5);
        return (
          <Card key={`${asset.id}-${portfolioName ?? ''}`} accessibilityLabel={`${asset.name}, ${v.grams} grams, ${v.value === null ? 'rate needed' : moneyShort(v.value)}`}>
            <View style={styles.row}>
              <View style={{ flexShrink: 1 }}>
                <Text style={styles.strong}>{asset.name}</Text>
                <Muted>
                  {v.grams} g · {tolaFromGrams(v.grams).toFixed(2)} tola{portfolioName ? ` · ${portfolioName}` : ''}
                </Muted>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 2 }}>
                <Text style={styles.number}>{v.value === null ? 'Rate needed' : moneyShort(v.value)}</Text>
                {v.gain === null ? <Muted>{v.cost === null ? 'cost not known' : ''}</Muted> : <Amount value={v.gain} text={signedMoney(v.gain)} size={13} label="Unrealised" />}
              </View>
            </View>
            <Muted>
              Bought {v.bought.grams} g for {moneyShort(v.bought.amount)} · sold {v.sold.grams} g for {moneyShort(v.sold.amount)}
              {v.realized === null ? '' : ` · realised ${signedMoney(v.realized)}`}
            </Muted>
            {recent.map((e) => (
              <View key={e.id} style={[styles.row, { marginTop: 6 }]} accessible accessibilityLabel={`${e.type === 'sell' ? 'Sold' : 'Bought'} ${describePieces(e)} on ${shortDate(e.date)}`}>
                <Text style={[styles.muted, { flexShrink: 1 }]}>
                  {shortDate(e.date)} · {e.type === 'opening' ? 'Opening' : e.type === 'buy' ? 'Bought' : 'Sold'} {describePieces(e)}
                </Text>
                <Text style={styles.muted}>{e.amount === null ? 'cost unknown' : money(e.amount)}</Text>
              </View>
            ))}
            {v.history.length > recent.length ? <Muted>Older entries are in the web app.</Muted> : null}
            {v.rate ? <Muted>Rate: {money(v.rate.pkrPerTola)} per tola · {v.rate.kind === 'local' ? 'dealer' : 'international estimate'} · {shortDate(v.rate.date)}</Muted> : null}
          </Card>
        );
      })}
    </>
  );
}
