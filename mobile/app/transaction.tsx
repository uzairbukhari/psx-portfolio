import { useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import type { QuotesResponse } from '@shared/api-types.ts';
import { SECTORS, today, type Dividend, type StockSplit, type Trade } from '@shared/portfolio.ts';
import { useAuth } from '@/auth/AuthProvider';
import { addCompany, isIsoDate, isValidSymbol, parseNumber, recordDividend, recordSplit, recordTrade, voidEntry, type EntryKind } from '@/data/mutations';
import { usePortfolio } from '@/data/usePortfolio';
import { colors } from '@/theme/tokens';
import { Button, Chip, Input, Muted, Notice, SectionLabel } from '@/ui/kit';

type Kind = 'buy' | 'sell' | 'dividend' | 'split' | 'opening';
const KINDS: { key: Kind; label: string }[] = [
  { key: 'buy', label: 'Buy' },
  { key: 'sell', label: 'Sell' },
  { key: 'dividend', label: 'Dividend' },
  { key: 'split', label: 'Split' },
  { key: 'opening', label: 'Opening' },
];

function Field({ label, value, onChangeText, placeholder, keyboard = 'default', multiline = false }: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboard?: 'default' | 'decimal-pad' | 'number-pad';
  multiline?: boolean;
}) {
  return (
    <Input
      label={label}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      keyboardType={keyboard}
      multiline={multiline}
      autoCapitalize="none"
      autoCorrect={false}
      style={multiline ? { minHeight: 70, textAlignVertical: 'top' } : undefined}
    />
  );
}

function Chips<T extends string>({ items, value, onChange, disabled }: { items: { key: T; label: string }[]; value: T | ''; onChange: (k: T) => void; disabled?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, opacity: disabled ? 0.6 : 1 }} pointerEvents={disabled ? 'none' : 'auto'}>
      {items.map((i) => (
        <Chip key={i.key} label={i.label} selected={value === i.key} onPress={() => onChange(i.key)} />
      ))}
    </View>
  );
}

export default function Transaction() {
  const params = useLocalSearchParams<{ ticker?: string; kind?: string; id?: string; shares?: string; price?: string; month?: string }>();
  const p = usePortfolio();
  const { api } = useAuth();
  const editingId = params.id || undefined;

  // Editing: find the existing entry and lock its kind and company.
  const existing = useMemo(() => {
    if (!editingId || !p.portfolio) return null;
    const t = p.portfolio.trades.find((x) => x.id === editingId);
    if (t) return { entryKind: 'trade' as EntryKind, kind: t.kind as Kind, trade: t };
    const d = p.portfolio.dividends?.find((x) => x.id === editingId);
    if (d) return { entryKind: 'dividend' as EntryKind, kind: 'dividend' as Kind, dividend: d };
    const sp = p.portfolio.stockSplits?.find((x) => x.id === editingId);
    if (sp) return { entryKind: 'split' as EntryKind, kind: 'split' as Kind, split: sp };
    return null;
  }, [editingId, p.portfolio]);

  const [kind, setKind] = useState<Kind>((params.kind as Kind) || 'buy');
  const [tickerChoice, setTicker] = useState((params.ticker ?? '').toUpperCase());
  const [date, setDate] = useState(today());
  const [shares, setShares] = useState(params.shares ?? '');
  const [price, setPrice] = useState(params.price ?? '');
  const [fees, setFees] = useState('');
  const [month, setMonth] = useState(params.month ?? '');
  const [perShare, setPerShare] = useState('');
  const [oldShares, setOldShares] = useState('');
  const [newShares, setNewShares] = useState('');
  const [note, setNote] = useState('');
  const [newCompany, setNewCompany] = useState(false);
  const [symbol, setSymbol] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [sector, setSector] = useState<string>('Others');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedFrom, setLoadedFrom] = useState<string | null>(null);

  // Prefill once from the entry being edited.
  if (existing && loadedFrom !== editingId) {
    setLoadedFrom(editingId ?? null);
    if ('trade' in existing && existing.trade) {
      const t: Trade = existing.trade;
      setKind(t.kind);
      setTicker(t.ticker);
      setDate(t.date);
      setShares(String(t.shares));
      setPrice(t.price === null ? '' : String(t.price));
      setFees(t.fees ? String(t.fees) : '');
      setMonth(t.month);
      setNote(t.note);
    } else if ('dividend' in existing && existing.dividend) {
      const d: Dividend = existing.dividend;
      setKind('dividend');
      setTicker(d.ticker);
      setDate(d.date);
      setPerShare(d.perShare ? String(d.perShare) : '');
      setNote(d.note);
    } else if ('split' in existing && existing.split) {
      const sp: StockSplit = existing.split;
      setKind('split');
      setTicker(sp.ticker);
      setDate(sp.date);
      setOldShares(String(sp.oldShares));
      setNewShares(String(sp.newShares));
      setNote(sp.note);
    }
  }

  const companies = useMemo(
    () => (p.portfolio?.companies ?? []).map((c) => ({ key: c.ticker, label: c.ticker })).sort((a, b) => a.key.localeCompare(b.key)),
    [p.portfolio],
  );
  const editing = Boolean(editingId);

  async function submit() {
    setError(null);
    if (!p.portfolio) return;
    try {
      let working = p.portfolio;
      let ticker = tickerChoice;
      if (newCompany) {
        ticker = symbol.trim().toUpperCase();
        if (!isValidSymbol(ticker)) throw new Error('Enter a valid PSX symbol (2-12 letters or digits).');
        if (working.companies.some((c) => c.ticker === ticker)) throw new Error(`${ticker} is already in your portfolio. Pick it from the list.`);
        setBusy(true);
        let confirmed;
        try {
          confirmed = (await api.post<QuotesResponse>('/api/quotes', { tickers: [ticker] })).quotes[ticker];
        } catch (e) {
          throw new Error(`${ticker} could not be confirmed on PSX: ${e instanceof Error ? e.message : 'try again'}`);
        }
        if (!confirmed) throw new Error(`${ticker} is not available as a current PSX symbol.`);
        working = addCompany(working, { ticker, name: companyName, sector }, confirmed);
      }
      if (!ticker) throw new Error('Choose a company.');
      if (!isIsoDate(date)) throw new Error('Enter the date as YYYY-MM-DD.');
      let next;
      if (kind === 'dividend') {
        const per = parseNumber(perShare);
        if (per === null || per <= 0) throw new Error('Enter the dividend per share.');
        next = recordDividend(working, { ticker, date, perShare: per, note: note.trim() }, editingId);
      } else if (kind === 'split') {
        const o = parseNumber(oldShares);
        const n = parseNumber(newShares);
        if (!o || !n || o <= 0 || n <= o) throw new Error('Enter the old and new share counts (new must be larger).');
        next = recordSplit(working, { ticker, date, oldShares: o, newShares: n, note: note.trim() }, editingId);
      } else {
        const sh = parseNumber(shares);
        if (!sh || sh <= 0 || !Number.isInteger(sh)) throw new Error('Enter a whole number of shares.');
        const pr = parseNumber(price);
        if (kind !== 'opening' && (pr === null || pr <= 0)) throw new Error('Enter the price per share.');
        const fee = parseNumber(fees) ?? 0;
        if (fee < 0) throw new Error('Fees cannot be negative.');
        if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('SIP month must look like 2026-10.');
        next = recordTrade(
          working,
          { ticker, kind, date, shares: sh, price: pr, fees: fee, month: kind === 'buy' ? month : '', note: note.trim() },
          editingId,
        );
      }
      setBusy(true);
      await p.save(next);
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  function confirmVoid() {
    if (!existing || !p.portfolio || !editingId) return;
    Alert.alert('Void this entry?', 'It stays in your history as voided but no longer counts.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Void',
        style: 'destructive',
        onPress: async () => {
          try {
            setBusy(true);
            await p.save(voidEntry(p.portfolio!, existing.entryKind, editingId));
            router.back();
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not void.');
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['bottom']}>
      <Stack.Screen options={{ title: editing ? 'Edit entry' : 'Add transaction' }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 56 : 0}>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          {editingId && !existing && !p.isLoading ? <Notice tone="error">That entry no longer exists.</Notice> : null}
          <SectionLabel>Type</SectionLabel>
          <Chips items={KINDS} value={kind} onChange={setKind} disabled={editing} />
          <SectionLabel>Company</SectionLabel>
          <Chips
            items={[...companies, ...(editing ? [] : [{ key: '__new', label: '+ New company' }])]}
            value={newCompany ? '__new' : tickerChoice}
            onChange={(k) => {
              setNewCompany(k === '__new');
              if (k !== '__new') setTicker(k);
            }}
            disabled={editing}
          />
          {newCompany ? (
            <>
              <Field label="PSX symbol" value={symbol} onChangeText={(v) => setSymbol(v.toUpperCase())} placeholder="e.g. MEBL" />
              <Field label="Company name" value={companyName} onChangeText={setCompanyName} />
              <SectionLabel>Sector</SectionLabel>
              <Chips items={SECTORS.map((x) => ({ key: x, label: x }))} value={sector} onChange={setSector} />
              <Muted>The symbol is confirmed against PSX when you save.</Muted>
            </>
          ) : null}
          <Field label="Date (YYYY-MM-DD)" value={date} onChangeText={setDate} />
          {kind === 'dividend' ? (
            <Field label="Dividend per share (PKR)" value={perShare} onChangeText={setPerShare} keyboard="decimal-pad" />
          ) : kind === 'split' ? (
            <>
              <Field label="Old shares" value={oldShares} onChangeText={setOldShares} keyboard="number-pad" placeholder="e.g. 4" />
              <Field label="New shares" value={newShares} onChangeText={setNewShares} keyboard="number-pad" placeholder="e.g. 5" />
            </>
          ) : (
            <>
              <Field label="Number of shares" value={shares} onChangeText={setShares} keyboard="number-pad" />
              <Field
                label={kind === 'opening' ? 'Average cost per share (optional)' : 'Price per share (PKR)'}
                value={price}
                onChangeText={setPrice}
                keyboard="decimal-pad"
              />
              <Field label="Fees (PKR)" value={fees} onChangeText={setFees} keyboard="decimal-pad" placeholder="0" />
              {kind === 'buy' ? <Field label="SIP month (optional, YYYY-MM)" value={month} onChangeText={setMonth} placeholder="2026-10" /> : null}
            </>
          )}
          <Field label="Note" value={note} onChangeText={setNote} multiline />
          {kind === 'dividend' ? <Muted>The gross amount is worked out from the shares you held on that date.</Muted> : null}
          {error ? <Notice tone="error">{error}</Notice> : null}
          <Button
            label={editing ? 'Save correction' : 'Save'}
            icon="check"
            loading={busy}
            disabled={editing && !existing}
            onPress={() => void submit()}
          />
          {editing && existing ? <Button label="Void this entry" variant="danger" disabled={busy} onPress={confirmVoid} /> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
