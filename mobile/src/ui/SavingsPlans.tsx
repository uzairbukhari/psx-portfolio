import { Text, View } from 'react-native';
import { dueEntries, planValue, type PlanAsset } from '@shared/plans.ts';
import { money, moneyShort, today } from '@shared/portfolio.ts';
import { shortDate, signedMoney } from '@/data/format';
import { Amount, Card, Muted, SectionLabel, useKitStyles } from './kit';

export type OwnedPlan = { asset: PlanAsset; portfolioName?: string };

/** Savings plans (Pak-Qatar Mahana Bachat and similar). Read-only on the phone for now; record changes on the web. */
export function SavingsPlans({ owned }: { owned: OwnedPlan[] }) {
  const styles = useKitStyles();
  const asOf = today();
  if (!owned.length) return null;
  return (
    <>
      <SectionLabel>Savings plans</SectionLabel>
      {owned.map(({ asset, portfolioName }) => {
        const v = planValue(asset, asOf);
        const due = dueEntries(asset, asOf);
        return (
          <Card key={`${asset.id}-${portfolioName ?? ''}`} accessibilityLabel={`${asset.name}, value ${moneyShort(v.value)}`}>
            <View style={styles.row}>
              <View style={{ flexShrink: 1 }}>
                <Text style={styles.strong}>{asset.name}</Text>
                <Muted>
                  {asset.closed ? 'Closed' : 'Active'}
                  {portfolioName ? ` · ${portfolioName}` : ''}
                </Muted>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 2 }}>
                <Text style={styles.number}>{moneyShort(v.value)}</Text>
                <Amount value={v.gain} text={signedMoney(v.gain)} size={13} label="Gain" />
              </View>
            </View>
            <Muted>
              Paid in {moneyShort(v.contributed)} · redeemed {moneyShort(v.redeemed)} · still in {moneyShort(v.cost)}
            </Muted>
            <Muted>
              {v.source === 'statement' ? `Value from your statement of ${shortDate(v.statementDate!)}.` : v.source === 'estimate' ? `Estimated from your statement of ${shortDate(v.statementDate!)}.` : 'No statement value yet; shown at the amount paid in.'}
            </Muted>
            {due.length ? <Muted>{due.length} monthly contribution{due.length === 1 ? '' : 's'} due ({money(due[0].amount)}). Confirm on the web.</Muted> : null}
          </Card>
        );
      })}
    </>
  );
}
