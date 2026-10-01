import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { money, today } from '@shared/portfolio.ts';
import { isIsoDate, parseNumber, setManualQuote } from '@/data/mutations';
import { usePortfolio } from '@/data/usePortfolio';
import { colors } from '@/theme/tokens';
import { Muted, Notice, styles as kit } from '@/ui/kit';

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
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
          {current ? <Muted>Saved price: {money(current.price)} as of {current.date}{current.manual ? ' (entered by you)' : ''}.</Muted> : null}
          <View style={{ gap: 6 }}>
            <Text style={kit.statLabel}>Price per share (PKR)</Text>
            <TextInput style={s.input} value={price} onChangeText={setPrice} keyboardType="decimal-pad" placeholderTextColor={colors.muted} />
          </View>
          <View style={{ gap: 6 }}>
            <Text style={kit.statLabel}>Price date (YYYY-MM-DD)</Text>
            <TextInput style={s.input} value={date} onChangeText={setDate} autoCapitalize="none" autoCorrect={false} />
          </View>
          <Muted>A price you enter is kept until PSX publishes a price for a later trading day.</Muted>
          {error ? <Notice tone="error">{error}</Notice> : null}
          <Pressable style={[kit.button, busy && { opacity: 0.5 }]} disabled={busy} onPress={() => void submit()}>
            <Text style={kit.buttonText}>{busy ? 'Saving…' : 'Save price'}</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  input: { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 10, padding: 12, color: colors.foreground, fontSize: 16 },
});
