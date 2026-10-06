import { Text, View } from 'react-native';
import { valueFund, type FundAsset } from '@shared/funds.ts';
import type { FundNavRow } from '@shared/mufap.ts';
import { moneyShort, today } from '@shared/portfolio.ts';
import { shortDate, signedMoney } from '@/data/format';
import { Amount, Card, Muted, SectionLabel, useKitStyles } from './kit';

export type OwnedFund = { asset: FundAsset; portfolioName?: string };

/** Mutual funds. Read-only on the phone for now; record changes on the web. */
export function MutualFunds({ owned, navs, navsError }: { owned: OwnedFund[]; navs: FundNavRow[]; navsError: string }) {
  const styles = useKitStyles();
  const asOf = today();
  if (!owned.length) return null;
  return (
    <>
      <SectionLabel>Mutual funds</SectionLabel>
      {navsError ? <Muted>{navsError}</Muted> : null}
      {owned.map(({ asset, portfolioName }) => {
        const v = valueFund(asset, navs, asOf);
        return (
          <Card key={`${asset.id}-${portfolioName ?? ''}`} accessibilityLabel={`${asset.name}, value ${v.value === null ? 'unknown' : moneyShort(v.value)}`}>
            <View style={styles.row}>
              <View style={{ flexShrink: 1 }}>
                <Text style={styles.strong}>{asset.name}</Text>
                <Muted>
                  {asset.amc}
                  {portfolioName ? ` · ${portfolioName}` : ''}
                </Muted>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 2 }}>
                <Text style={styles.number}>{v.value === null ? '—' : moneyShort(v.value)}</Text>
                <Amount value={v.gain} text={signedMoney(v.gain)} size={13} label="Gain" />
              </View>
            </View>
            <Muted>
              {Math.round(v.units * 1000) / 1000} units · {v.cost === null ? 'cost unknown' : `still in ${moneyShort(v.cost)}`}
            </Muted>
            <Muted>
              {v.price ? `Price Rs ${v.price.nav.toFixed(4)} from ${v.price.source === 'manual' ? 'your entry' : 'MUFAP'} on ${shortDate(v.price.date)}${v.price.stale ? ' (old)' : ''}.` : 'No price yet, so the value is unknown.'}
            </Muted>
          </Card>
        );
      })}
    </>
  );
}
