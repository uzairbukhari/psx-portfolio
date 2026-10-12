import { Text, View } from 'react-native';
import { dueEntries, planValue, type PlanAsset } from '@shared/plans.ts';
import { money, moneyShort, today } from '@shared/portfolio.ts';
import { shortDate, signedMoney } from '@/data/format';
import { useTheme } from '@/theme/ThemeProvider';
import { Amount, Fact, Muted, SectionHeader, StatusChip, useKitStyles } from './kit';

export type OwnedPlan = { asset: PlanAsset; portfolioName?: string };

/** Savings plans (Pak-Qatar Mahana Bachat and similar). Read-only on the phone for now; record changes on the web. */
export function SavingsPlans({ owned }: { owned: OwnedPlan[] }) {
  const styles = useKitStyles();
  const { colors } = useTheme();
  const asOf = today();
  if (!owned.length) return null;
  const values = owned.map(({ asset }) => planValue(asset, asOf));
  const total = values.reduce((n, v) => n + v.value, 0);
  return (
    <>
      <SectionHeader title="Savings plans" count={owned.length} value={moneyShort(total)} />
      <View style={[styles.card, { padding: 0, overflow: 'hidden' }]}>
        {owned.map(({ asset, portfolioName }, i) => {
          const v = values[i];
          const due = dueEntries(asset, asOf);
          return (
            <View
              key={`${asset.id}-${portfolioName ?? ''}`}
              accessible
              accessibilityLabel={`${asset.name}, value ${moneyShort(v.value)}, paid in ${moneyShort(v.contributed)}`}
              style={[{ padding: 14, gap: 12 }, i > 0 && { borderTopWidth: 1, borderTopColor: colors.line }]}
            >
              <View style={styles.row}>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={styles.strong}>{asset.name}</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    <StatusChip text={asset.closed ? 'Closed' : 'Active'} tone={asset.closed ? 'neutral' : 'success'} />
                    {portfolioName ? <StatusChip text={portfolioName} /> : null}
                  </View>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 2 }}>
                  <Text style={styles.number}>{moneyShort(v.value)}</Text>
                  <Amount value={v.gain} text={signedMoney(v.gain)} size={13} label="Gain" />
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <Fact label="Paid in" value={moneyShort(v.contributed)} />
                {v.redeemed > 0 ? <Fact label="Redeemed" value={moneyShort(v.redeemed)} /> : null}
                <Fact label="Still in" value={moneyShort(v.cost)} />
              </View>
              <Muted>
                {v.source === 'statement' ? `Value from your statement of ${shortDate(v.statementDate!)}.` : v.source === 'estimate' ? `Estimated from your statement of ${shortDate(v.statementDate!)}.` : 'No statement value yet, so it is shown at the amount paid in.'}
              </Muted>
              {due.length ? <StatusChip tone="warn" text={`${due.length} monthly contribution${due.length === 1 ? '' : 's'} due (${money(due[0].amount)}) · confirm on the web`} /> : null}
            </View>
          );
        })}
      </View>
    </>
  );
}
