'use client';
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { replaceEntry } from '@/lib/corrections';
import { fieldText, hasErrors, parseField, type FieldErrors } from '@/lib/forms';
import { pkr, shares as fmtShares } from '@/lib/format';
import { clonePortfolio } from '../hooks/use-portfolio';
import {
  sharesHeldOn,
  today,
  type Portfolio,
  type Trade,
} from '@/lib/portfolio';
import { usePortfolioContext } from '../portfolio-context';
import { DialogError, Field, useSubmit } from './use-submit';
import { VoidEntryButton, useVoidWithUndo } from './void-entry';

type Kind = Trade['kind'];
type Errors = FieldErrors<'ticker' | 'date' | 'shares' | 'price' | 'fees'>;

type Draft = {
  ticker: string;
  kind: Kind;
  date: string;
  shares: string;
  price: string;
  fees: string;
  month: string;
  note: string;
};

function initialDraft(
  editing: Trade | undefined,
  ticker: string | undefined,
  kind: 'buy' | 'sell' | undefined,
  quotePrice: number | null,
): Draft {
  if (editing)
    return {
      ticker: editing.ticker,
      kind: editing.kind,
      date: editing.date,
      shares: fieldText(editing.shares),
      price: fieldText(editing.price),
      fees: fieldText(editing.fees),
      month: editing.month,
      note: editing.note,
    };
  const k = kind ?? 'buy';
  return {
    ticker: ticker ?? '',
    kind: k,
    date: today(),
    shares: '',
    price: k === 'sell' ? fieldText(quotePrice) : '',
    fees: '0',
    month: k === 'buy' ? today().slice(0, 7) : '',
    note: '',
  };
}

/** Portfolio as it would be with the entry being corrected removed, for "shares held" checks. */
function baseWithout(p: Portfolio, editing: Trade | undefined): Portfolio {
  if (!editing) return p;
  const copy = clonePortfolio(p);
  const old = copy.trades.find((t) => t.id === editing.id);
  if (old) old.voided = true;
  return copy;
}

export function TradeDialog({
  ticker,
  kind,
  editing,
  onClose,
}: {
  ticker?: string;
  kind?: 'buy' | 'sell';
  editing?: Trade;
  onClose: () => void;
}) {
  const { p, saving, save, toast, goTab } = usePortfolioContext();
  const voidWithUndo = useVoidWithUndo();
  const submit = useSubmit();
  const [d, setD] = useState<Draft>(() =>
    initialDraft(editing, ticker, kind, p.quotes[ticker ?? '']?.price ?? null),
  );
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setD((prev) => ({ ...prev, [key]: value }));

  const opening = d.kind === 'opening';
  const qty = parseField(d.shares);
  const price = parseField(d.price);
  const fees = parseField(d.fees);
  const known = p.companies.some((c) => c.ticker === d.ticker);
  const base = baseWithout(p, editing);
  const held =
    known && d.date ? sharesHeldOn(base, d.ticker, d.date) : null;

  const errors: Errors = {};
  if (!d.ticker) errors.ticker = 'Enter the PSX symbol.';
  else if (!known)
    errors.ticker = `${d.ticker} is not in your companies yet. Add the company first.`;
  if (!d.date) errors.date = 'Choose the trade date.';
  else if (d.date > today()) errors.date = 'The date cannot be in the future.';
  if (qty === null) errors.shares = 'Enter the number of shares.';
  else if (!Number.isInteger(qty) || qty < 1)
    errors.shares = 'Shares must be a whole number of 1 or more.';
  else if (d.kind === 'sell' && held !== null && qty > held)
    errors.shares = `You hold ${fmtShares(held)} share${held === 1 ? '' : 's'} of ${d.ticker} on ${d.date}.`;
  if (!opening && price === null) errors.price = 'Enter the price per share.';
  else if (price !== null && price <= 0)
    errors.price = 'The price must be above zero.';
  if (fees === null) errors.fees = 'Enter fees (0 if none).';
  else if (fees < 0) errors.fees = 'Fees cannot be negative.';

  const showErrors = submit.attempted;
  // Overselling is surfaced live as soon as a quantity is typed; other errors wait for a save attempt.
  const liveOversell = d.kind === 'sell' && qty !== null && held !== null && qty > held;
  const visible: Errors = showErrors
    ? errors
    : liveOversell && errors.shares
      ? { shares: errors.shares }
      : {};

  const total =
    qty !== null && price !== null && fees !== null && qty > 0
      ? d.kind === 'sell'
        ? qty * price - fees
        : qty * price + fees
      : null;
  const verb = opening ? 'Opening balance' : d.kind === 'sell' ? 'Sell' : 'Buy';

  function onSubmit(event: React.SyntheticEvent) {
    event.preventDefault();
    void submit.run(async () => {
      if (hasErrors(errors))
        throw Error('Fix the highlighted fields, then save again.');
      // A correction keeps broker metadata (source, external id, tax withheld) of the entry it replaces.
      const { voided: _voided, ...carried } = editing ?? ({} as Partial<Trade>);
      const entry: Trade = {
        ...carried,
        id: crypto.randomUUID(),
        ticker: d.ticker,
        kind: d.kind,
        date: d.date,
        shares: qty!,
        price: opening && price === null ? null : price,
        fees: fees!,
        month: d.kind === 'buy' ? d.month : '',
        note: d.note,
      };
      const next = clonePortfolio(p);
      next.trades = replaceEntry(next.trades, editing?.id, entry);
      await save(next);
      onClose();
      toast({
        title: editing
          ? 'Correction saved'
          : `${d.kind === 'sell' ? 'Sale' : 'Purchase'} saved`,
        description: editing
          ? 'Previous entry retained as voided.'
          : `${d.ticker}: ${fmtShares(entry.shares)} shares. Holdings and average cost updated.`,
        type: 'success',
        action: {
          label: 'View in log',
          onClick: () => goTab('history'),
        },
      });
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="form-dialog">
        <DialogTitle>
          {editing
            ? 'Correct transaction'
            : d.kind === 'sell'
              ? 'Record a sale'
              : 'Record a purchase'}
        </DialogTitle>
        <DialogDescription>
          {opening
            ? 'Enter the original average purchase cost if known. The statement date remains the opening snapshot date.'
            : 'Record the shares and actual price from your broker confirmation.'}
        </DialogDescription>
        <form onSubmit={onSubmit} noValidate>
          {!editing && !opening && (
            <fieldset className="seg">
              <legend className="sr-only">Transaction type</legend>
              {(['buy', 'sell'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={d.kind === k}
                  data-active={d.kind === k || undefined}
                  onClick={() =>
                    setD((prev) => ({
                      ...prev,
                      kind: k,
                      month: k === 'buy' ? today().slice(0, 7) : '',
                      price:
                        k === 'sell' && prev.price === ''
                          ? fieldText(p.quotes[prev.ticker]?.price)
                          : prev.price,
                    }))
                  }
                >
                  {k === 'buy' ? 'Buy' : 'Sell'}
                </button>
              ))}
            </fieldset>
          )}
          <div className="form-grid">
            <Field id="trade-ticker" label="Company symbol" error={visible.ticker}>
              {(a) => (
                <>
                  <input
                    {...a}
                    list="symbols"
                    autoComplete="off"
                    value={d.ticker}
                    onChange={(e) => set('ticker', e.target.value.toUpperCase())}
                  />
                  <datalist id="symbols">
                    {p.companies.map((c) => (
                      <option key={c.ticker} value={c.ticker}>
                        {c.name}
                      </option>
                    ))}
                  </datalist>
                </>
              )}
            </Field>
            <Field
              id="trade-date"
              label={opening ? 'Opening snapshot date' : 'Trade date'}
              error={visible.date}
            >
              {(a) => (
                <input
                  {...a}
                  type="date"
                  max={today()}
                  value={d.date}
                  onChange={(e) => set('date', e.target.value)}
                />
              )}
            </Field>
            <Field
              id="trade-shares"
              label="Number of shares"
              error={visible.shares}
              hint={
                d.kind === 'sell' && held !== null && !visible.shares
                  ? `You hold ${fmtShares(held)} share${held === 1 ? '' : 's'} on this date.`
                  : undefined
              }
            >
              {(a) => (
                <input
                  {...a}
                  type="number"
                  inputMode="numeric"
                  min="1"
                  step="1"
                  value={d.shares}
                  onChange={(e) => set('shares', e.target.value)}
                />
              )}
            </Field>
            <Field
              id="trade-price"
              label={opening ? 'Average cost per share (optional)' : 'Price per share (PKR)'}
              error={visible.price}
            >
              {(a) => (
                <input
                  {...a}
                  type="number"
                  inputMode="decimal"
                  min="0.0001"
                  step="any"
                  value={d.price}
                  onChange={(e) => set('price', e.target.value)}
                />
              )}
            </Field>
            <Field id="trade-fees" label="Fees (PKR)" error={visible.fees}>
              {(a) => (
                <input
                  {...a}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={d.fees}
                  onChange={(e) => set('fees', e.target.value)}
                />
              )}
            </Field>
            {d.kind === 'buy' && (
              <Field id="trade-month" label="SIP month (optional)">
                {(a) => (
                  <input
                    {...a}
                    type="month"
                    value={d.month}
                    onChange={(e) => set('month', e.target.value)}
                  />
                )}
              </Field>
            )}
            <Field id="trade-note" label="Note" wide>
              {(a) => (
                <textarea
                  {...a}
                  maxLength={2000}
                  value={d.note}
                  onChange={(e) => set('note', e.target.value)}
                />
              )}
            </Field>
          </div>
          <div className="txn-summary" aria-live="polite">
            <span>Summary</span>
            <b>
              {qty !== null && qty > 0 && d.ticker
                ? `${verb} ${fmtShares(qty)} ${d.ticker}${price !== null ? ` at ${pkr(price)}` : ''} on ${d.date || '—'}`
                : 'Fill in the fields to see a summary.'}
            </b>
            <small>
              {opening && price === null
                ? 'Cost remains unknown.'
                : total === null
                  ? 'Total appears once shares, price and fees are valid.'
                  : `Fees ${pkr(fees)} · ${d.kind === 'sell' ? 'Cash received' : 'Cash invested'}: ${pkr(total)}`}
            </small>
          </div>
          <DialogError
            error={submit.error}
            conflict={submit.conflict}
            onReload={() => void submit.reloadLatest()}
          />
          <div className="row dialog-actions">
            <button type="submit" disabled={saving}>
              {saving ? 'Saving…' : `Save ${d.kind === 'sell' ? 'sale' : 'entry'}`}
            </button>
            <button type="button" className="secondary" onClick={onClose}>
              Cancel
            </button>
            {editing && (
              <VoidEntryButton
                what="entry"
                disabled={saving}
                onConfirm={() =>
                  submit.run(async () => {
                    await voidWithUndo('trades', editing.id, 'Entry voided');
                    onClose();
                  })
                }
              />
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
