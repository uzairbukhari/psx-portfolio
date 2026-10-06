import { useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import type { QuotesResponse } from '@shared/api-types.ts';
import { SECTORS, money, today, type Dividend, type StockSplit, type Trade } from '@shared/portfolio.ts';
import { useAuth } from '@/auth/AuthProvider';
import { addCompany, isIsoDate, isValidSymbol, parseNumber, recordDividend, recordSplit, recordTrade, voidEntry, type EntryKind } from '@/data/mutations';
import { readOnlyReason } from '@/data/derive';
import { usePortfolio } from '@/data/usePortfolio';
import { useTheme } from '@/theme/ThemeProvider';
import { splitPreview, tradeTotals } from '@/data/entry-form';
import { CompanyPicker, NEW_COMPANY } from '@/ui/CompanyPicker';
import { DatePicker } from '@/ui/DatePicker';
import { MonthPicker } from '@/ui/MonthPicker';
import { useToast } from '@/ui/Toast';
import { Button, Card, Chip, Input, Muted, Notice, SectionLabel, useKitStyles } from '@/ui/kit';

type Kind = Trade['kind'] | 'dividend' | 'split';
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

/** Closes the sheet; if it was opened with nothing behind it (a deep link), go home instead of leaving a blank screen. */
function closeScreen() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

export default function Transaction() {
  const kit = useKitStyles();
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ ticker?: string; kind?: string; id?: string; shares?: string; price?: string; month?: string }>();
  const selection = usePortfolio();
  const [destination, setDestination] = useState('');
  const ownerId = params.id?.includes('::') ? params.id.split('::')[0] : undefined;
  const p = usePortfolio(destination || ownerId);
  const { api } = useAuth();
  const toast = useToast();
  const editingId = params.id?.includes('::') ? params.id.slice(params.id.indexOf('::')+2) : params.id || undefined;

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
    () => (p.portfolio?.companies ?? []).map((c) => ({ ticker: c.ticker, name: c.name })),
    [p.portfolio],
  );
  // Live figures shown above Save so the amount is known before it is recorded.
  const totals = useMemo(
    () => (kind === 'buy' || kind === 'sell' || kind === 'opening' ? tradeTotals(kind, parseNumber(shares), parseNumber(price), parseNumber(fees)) : null),
    [kind, shares, price, fees],
  );
  const split = useMemo(
    () => (kind === 'split' && p.portfolio && !newCompany && isIsoDate(date) ? splitPreview(p.portfolio, tickerChoice, date, parseNumber(oldShares), parseNumber(newShares)) : null),
    [kind, p.portfolio, newCompany, date, tickerChoice, oldShares, newShares],
  );
  const editing = Boolean(editingId);
  // Deep links can reach any entry id; imported, automatic and voided entries are not editable here.
  const locked = p.locked ? 'This portfolio is locked. Unlock it in Settings → Portfolios.' : kind === 'adjustment'
    ? 'Holding adjustments come from statement imports. Review or void them on the web.'
    : editingId && p.portfolio ? readOnlyReason(p.portfolio, editingId) : null;

  async function submit() {
    setError(null);
    if (p.isAll) { setError('Choose a destination portfolio.'); return; }
    if (!p.portfolio) return;
    try {
      if (kind === 'adjustment') throw new Error('Holding adjustments cannot be entered here.');
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
      const previous = p.portfolio;
      const savedRevision = await p.save(next);
      // Undo is a second revisioned save of the portfolio as it was; a change from another device in between
      // makes it fail with the usual "portfolio changed" message instead of overwriting that change.
      toast.show({
        message: `${editing ? 'Correction saved' : `${kind === 'buy' ? 'Buy' : kind === 'sell' ? 'Sale' : kind === 'dividend' ? 'Dividend' : kind === 'split' ? 'Split' : 'Opening balance'} recorded`} for ${ticker}`,
        actionLabel: 'Undo',
        onAction: async () => {
          await p.save(previous, { expectedRevision: savedRevision });
          toast.show({ message: 'Undone. Your portfolio is back as it was.' });
        },
      });
      closeScreen();
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
            const previous = p.portfolio!;
            const savedRevision = await p.save(voidEntry(previous, existing.entryKind, editingId));
            toast.show({
              message: 'Entry voided',
              actionLabel: 'Undo',
              onAction: async () => {
                await p.save(previous, { expectedRevision: savedRevision });
                toast.show({ message: 'Undone. The entry counts again.' });
              },
            });
            closeScreen();
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not void.');
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  }

  if (locked)
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['bottom']}>
        <Stack.Screen options={{ title: 'Edit entry' }} />
        <View style={{ padding: 16, gap: 14 }}>
          <Notice>{locked}</Notice>
          <Button label="Back" variant="outline" onPress={() => router.back()} />
        </View>
      </SafeAreaView>
    );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['bottom']}>
      <Stack.Screen options={{ title: editing ? 'Edit entry' : 'Add transaction' }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 56 : 0}>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          {selection.account && selection.account.portfolios.length>1 && !editing ? <Card><SectionLabel>Portfolio</SectionLabel><Chips items={selection.account.portfolios.filter((entry)=>!entry.locked).map((entry)=>({key:entry.id,label:entry.name}))} value={p.targetId ?? ''} disabled={busy} onChange={(id)=>{setDestination(id);setTicker('');}} />{p.isAll ? <Muted>Choose a portfolio to enter this transaction.</Muted> : null}</Card> : null}
          <View pointerEvents={p.isAll ? 'none' : 'auto'} style={{opacity:p.isAll ? 0.4 : 1}}>
          {editingId && !existing && !p.isLoading ? <Notice tone="error">That entry no longer exists.</Notice> : null}
          <SectionLabel>Type</SectionLabel>
          <Chips items={KINDS} value={kind} onChange={setKind} disabled={editing} />
          <SectionLabel>Company</SectionLabel>
          <CompanyPicker
            companies={companies}
            value={tickerChoice}
            allowNew={!editing}
            newSelected={newCompany}
            disabled={editing}
            onChange={(k) => {
              setNewCompany(k === NEW_COMPANY);
              if (k !== NEW_COMPANY) setTicker(k);
            }}
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
          <DatePicker label="Date" value={date} onChange={setDate} />
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
              {kind === 'buy' ? <MonthPicker label="SIP month (optional)" value={month} onChange={setMonth} disabled={busy} /> : null}
            </>
          )}
          {totals ? (
            <Card accessibilityLabel={`${totals.label}: ${money(totals.total)}. Shares times price ${money(totals.gross)}, fees ${money(totals.fees)}.`}>
              <Text style={kit.statLabel}>{totals.label}</Text>
              <Text style={{ color: colors.ink, fontSize: 24, lineHeight: 30, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{money(totals.total)}</Text>
              <Muted>
                {money(totals.gross)} {kind === 'sell' ? 'less' : 'plus'} {money(totals.fees)} fees
              </Muted>
            </Card>
          ) : null}
          {split ? (
            'error' in split ? (
              <Notice>{split.error}</Notice>
            ) : (
              <Card accessibilityLabel={`Split preview: you hold ${split.before} shares on that date and will hold ${split.after} after the split.`}>
                <Text style={kit.statLabel}>Split preview</Text>
                <Text style={{ color: colors.ink, fontSize: 18, lineHeight: 24, fontWeight: '700' }}>
                  {split.before.toLocaleString('en-PK')} → {split.after.toLocaleString('en-PK')} shares
                </Text>
                <Muted>Held on {date}, before and after the split. Cost stays the same, so the average cost per share falls.</Muted>
              </Card>
            )
          ) : null}
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
          {editing && existing ? <Button label="Void this entry" variant="destructive" disabled={busy} onPress={confirmVoid} /> : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
