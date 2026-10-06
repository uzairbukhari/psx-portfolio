import { Text } from 'react-native';
import { router } from 'expo-router';
import {
  accountActivity,
  consolidatedAccount,
} from '@shared/portfolio-account.ts';
import { usePortfolio } from '@/data/usePortfolio';
import {
  Button,
  Card,
  Loading,
  Muted,
  Notice,
  Screen,
  SectionLabel,
  useKitStyles,
} from './kit';

export function ChoosePortfolio({ purpose }: { purpose: string }) {
  const p = usePortfolio();
  const styles = useKitStyles();
  return (
    <Screen>
      <Text style={styles.title}>Choose a portfolio</Text>
      <Muted>{purpose} Each portfolio has its own ledger and SIP plan.</Muted>
      {p.isLoading ? <Loading /> : null}
      {p.account?.portfolios.filter((entry)=>!entry.locked).map((entry) => (
        <Button
          variant="outline"
          key={entry.id}
          label={entry.name}
          onPress={() => p.select(entry.id)}
        />
      ))}
      <Button
        variant="text"
        label="Create or manage portfolios"
        onPress={() => router.push('/portfolios')}
      />
    </Screen>
  );
}
