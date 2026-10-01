import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { money, today } from '@shared/portfolio.ts';
import { isIsoDate, parseNumber, setManualQuote } from '@/data/mutations';
import { usePortfolio } from '@/data/usePortfolio';
import { colors } from '@/theme/tokens';
import { Button, Card, Input, Muted, Notice } from '@/ui/kit';

// Enter a price by hand, e.g. when PSX has no fresh quote. It holds until PSX publishes a later trading day.
export default function ManualQuote() {
  const { ticker: raw } = useLocalSearchParams<{ ticker: string }>();
  const ticker = String(raw ?? '').toUpperCase();
  const p = usePortfolio();
  const current = p.portfolio?.quotes[ticker];
  const [price, setPrice] = useState('');
  const [date, setDate] = useState(today());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (!p.portfolio) return;
    try {
      const value = parseNumber(price);
      if (value === null) throw new Error('Enter the price.');
      if (!isIsoDate(date)) throw new Error('Enter the date as YYYY-MM-DD.');
      setBusy(true);
      await p.save(setManualQuote(p.portfolio, ticker, value, date));
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['bottom']}>
      <Stack.Screen options={{ title: `${ticker} price` }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 56 : 0}>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
          {current ? (
            <Card>
              <Muted>Saved price</Muted>
              <Muted>
                {money(current.price)} as of {current.date}
                {current.manual ? ' (entered by you)' : ''}
              </Muted>
            </Card>
          ) : null}
          <Input label="Price per share (PKR)" value={price} onChangeText={setPrice} keyboardType="decimal-pad" autoFocus />
          <Input label="Price date" hint="Format: YYYY-MM-DD" value={date} onChangeText={setDate} autoCapitalize="none" autoCorrect={false} />
          <Muted>A price you enter is kept until PSX publishes a price for a later trading day.</Muted>
          {error ? <Notice tone="error">{error}</Notice> : null}
          <Button label="Save price" icon="check" loading={busy} onPress={() => void submit()} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
