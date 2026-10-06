import { ChoosePortfolio } from '@/ui/AllPortfolios';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { money, today } from '@shared/portfolio.ts';
import { companyDividends } from '@/data/derive';
import { isIsoDate, markDividendReceived, parseNumber } from '@/data/mutations';
import { usePortfolio } from '@/data/usePortfolio';
import { useTheme } from '@/theme/ThemeProvider';
import { Button, Card, Input, Loading, Muted, Notice, useKitStyles } from '@/ui/kit';

/** Confirms that an expected PSX dividend arrived, with the actual gross amount and tax withheld if they differ. */
export default function Received() {
  const styles = useKitStyles();
  const { colors } = useTheme();
  const { id: raw } = useLocalSearchParams<{ id: string }>();
  const fullId = String(raw ?? '');
  const ownerId = fullId.includes('::') ? fullId.split('::')[0] : undefined;
  const id = ownerId ? fullId.slice(ownerId.length+2) : fullId;
  const p = usePortfolio(ownerId);
  const dividend = p.portfolio?.dividends?.find((d) => d.id === id);
  const row = dividend && p.portfolio ? companyDividends(p.portfolio, dividend.ticker).find((r) => r.id === id) : undefined;
  const [paymentDate, setPaymentDate] = useState(today());
  const [gross, setGross] = useState('');
  const [tax, setTax] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!p.portfolio) return;
    setError(null);
    try {
      if (!isIsoDate(paymentDate)) throw new Error('Enter the payment date as YYYY-MM-DD.');
      const grossAmount = gross.trim() === '' ? null : parseNumber(gross);
      const taxWithheld = tax.trim() === '' ? null : parseNumber(tax);
      if ((gross.trim() !== '' && grossAmount === null) || (tax.trim() !== '' && taxWithheld === null))
        throw new Error('Enter amounts as positive numbers, or leave them blank.');
      setBusy(true);
      await p.save(markDividendReceived(p.portfolio, id, { paymentDate, grossAmount, taxWithheld }));
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not mark the dividend received.');
    } finally {
      setBusy(false);
    }
  }

  const waiting = row?.status === 'expected';
  if (p.isAll) return <ChoosePortfolio purpose="Choose the portfolio that received this dividend." />;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['bottom']}>
      <Stack.Screen options={{ title: dividend ? `${dividend.ticker} dividend` : 'Dividend' }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 56 : 0}>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
          {p.isLoading ? <Loading /> : null}
          {!p.isLoading && (!row || !dividend) ? <Notice tone="error">That dividend is no longer in your portfolio.</Notice> : null}
          {row && dividend && !waiting ? <Notice>This dividend is already marked received.</Notice> : null}
          {row && dividend && waiting ? (
            <>
              <Card>
                <Text style={styles.strong}>{dividend.ticker} dividend received</Text>
                <Muted>
                  Expected {money(row.gross)} gross{row.perShare ? ` (${money(row.perShare)} per share)` : ''} for book closure {row.date}
                  {row.entitlementDate ? `, shares held on ${row.entitlementDate}` : ''}.
                </Muted>
              </Card>
              <Input label="Payment date" hint="YYYY-MM-DD" value={paymentDate} onChangeText={setPaymentDate} autoCapitalize="none" autoCorrect={false} maxLength={10} />
              <Input label="Gross amount received (PKR)" hint={`Leave blank to keep ${money(row.gross)}`} value={gross} onChangeText={setGross} keyboardType="decimal-pad" />
              <Input label="Tax withheld (PKR)" hint="Leave blank to use the tax estimate" value={tax} onChangeText={setTax} keyboardType="decimal-pad" />
              <Muted>Expected dividends are planning figures. Once marked received, this counts as dividend income.</Muted>
              {error ? <Notice tone="error">{error}</Notice> : null}
              <Button label="Mark received" icon="check" loading={busy} onPress={() => void submit()} />
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
