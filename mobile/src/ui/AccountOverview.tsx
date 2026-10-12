import { Text, View } from 'react-native';
import type { AccountOverview as Overview } from '@shared/account-overview.ts';
import { moneyShort } from '@shared/portfolio.ts';
import { signedMoney } from '@/data/format';
import { Amount, ListRow, SectionLabel, StatusChip, useKitStyles } from './kit';

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
