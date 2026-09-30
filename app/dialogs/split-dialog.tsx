'use client';
import { useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { replaceEntry } from '@/lib/corrections';
import { fieldText, hasErrors, parseField, type FieldErrors } from '@/lib/forms';
import { pkr, shares as fmtShares } from '@/lib/format';
import {
  holdings,
  sharesHeldBefore,
  today,
  validate,
  type Portfolio,
  type StockSplit,
} from '@/lib/portfolio';
import { clonePortfolio } from '../hooks/use-portfolio';
import { usePortfolioContext } from '../portfolio-context';
import { DialogError, Field, useSubmit } from './use-submit';
import { VoidEntryButton, useVoidWithUndo } from './void-entry';

export function SplitDialog({
  ticker,
  editing,
  onClose,
}: {
  ticker?: string;
  editing?: StockSplit;
  onClose: () => void;
}) {
  const { p, saving, save, toast, goTab } = usePortfolioContext();
  const voidWithUndo = useVoidWithUndo();
  const submit = useSubmit();
  const [d, setD] = useState(() => ({
    ticker: editing?.ticker ?? ticker ?? '',
    date: editing?.date ?? today(),
    oldShares: fieldText(editing?.oldShares ?? 1),
    newShares: fieldText(editing?.newShares ?? 2),
    note: editing?.note ?? '',
  }));
  const oldShares = parseField(d.oldShares);
  const newShares = parseField(d.newShares);
  const known = p.companies.some((c) => c.ticker === d.ticker);

  const errors: FieldErrors<'ticker' | 'date' | 'oldShares' | 'newShares'> = {};
  if (!d.ticker) errors.ticker = 'Enter the PSX symbol.';
  else if (!known) errors.ticker = `${d.ticker} is not in your companies.`;
  if (!d.date) errors.date = 'Choose the effective date.';
  else if (d.date > today()) errors.date = 'The date cannot be in the future.';
  if (oldShares === null || !Number.isInteger(oldShares) || oldShares < 1)
    errors.oldShares = 'Enter a whole number of 1 or more.';
  if (newShares === null || !Number.isInteger(newShares))
    errors.newShares = 'Enter a whole number.';
  else if (oldShares !== null && newShares <= oldShares)
    errors.newShares = `Must be more than ${oldShares} (splits only increase shares).`;
  const visible = submit.attempted ? errors : {};

  // The preview reads the ledger with a shallow copy: no deep clone per keystroke.
  const valid = !hasErrors(errors);
  const preview = useMemo(() => {
    if (!valid) return null;
    const draft: StockSplit = {
      id: editing?.id ?? 'preview',
      ticker: d.ticker,
      date: d.date,
      oldShares: oldShares!,
      newShares: newShares!,
      note: '',
    };
    const base: Portfolio = {
      ...p,
      stockSplits: (p.stockSplits ?? []).map((s) =>
        s.id === editing?.id ? { ...s, voided: true } : s,
      ),
    };
    try {
      const before = sharesHeldBefore(base, d.ticker, d.date);
      const after = (before * draft.newShares) / draft.oldShares;
      const withDraft: Portfolio = {
        ...base,
        stockSplits: [...(base.stockSplits ?? []), { ...draft, id: 'preview' }],
      };
      validate(withDraft);
      const result = holdings(withDraft).find((h) => h.ticker === d.ticker);
      return { ok: true as const, before, after, result };
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }, [valid, p, editing?.id, d.ticker, d.date, oldShares, newShares]);

  function onSubmit(event: React.SyntheticEvent) {
    event.preventDefault();
    void submit.run(async () => {
      if (hasErrors(errors))
        throw Error('Fix the highlighted fields, then save again.');
      const entry: StockSplit = {
        id: crypto.randomUUID(),
        ticker: d.ticker,
        date: d.date,
        oldShares: oldShares!,
        newShares: newShares!,
        note: d.note,
      };
      const next = clonePortfolio(p);
      next.stockSplits = replaceEntry(next.stockSplits ?? [], editing?.id, entry);
      await save(next);
      onClose();
      toast({
        title: editing ? 'Split correction saved' : 'Stock split saved',
        description: editing
          ? 'Previous entry retained as voided.'
          : 'Shares and average costs were recalculated.',
        type: 'success',
        action: { label: 'View in log', onClick: () => goTab('history') },
      });
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="form-dialog">
        <DialogTitle>{editing ? 'Correct stock split' : 'Record stock split'}</DialogTitle>
        <DialogDescription>
          A split changes the number of shares held before its effective date.
          Total purchase cost stays unchanged.
        </DialogDescription>
        <form onSubmit={onSubmit} noValidate>
          <div className="form-grid">
            <Field id="split-ticker" label="Company symbol" error={visible.ticker}>
              {(a) => (
                <>
                  <input
                    {...a}
                    list="split-symbols"
                    autoComplete="off"
                    disabled={!!editing || !!ticker}
                    value={d.ticker}
                    onChange={(e) => setD({ ...d, ticker: e.target.value.toUpperCase() })}
                  />
                  <datalist id="split-symbols">
                    {p.companies.map((c) => (
                      <option key={c.ticker} value={c.ticker}>
                        {c.name}
                      </option>
                    ))}
                  </datalist>
                </>
              )}
            </Field>
            <Field id="split-date" label="Effective date" error={visible.date}>
              {(a) => (
                <input
                  {...a}
                  type="date"
                  max={today()}
                  value={d.date}
                  onChange={(e) => setD({ ...d, date: e.target.value })}
                />
              )}
            </Field>
            <Field id="split-old" label="Old shares" error={visible.oldShares}>
              {(a) => (
                <input
                  {...a}
                  type="number"
                  inputMode="numeric"
                  min="1"
                  step="1"
                  value={d.oldShares}
                  onChange={(e) => setD({ ...d, oldShares: e.target.value })}
                />
              )}
            </Field>
            <Field id="split-new" label="New shares" error={visible.newShares}>
              {(a) => (
                <input
                  {...a}
                  type="number"
                  inputMode="numeric"
                  min={(oldShares ?? 1) + 1}
                  step="1"
                  value={d.newShares}
                  onChange={(e) => setD({ ...d, newShares: e.target.value })}
                />
              )}
            </Field>
            <Field id="split-note" label="Note" wide>
              {(a) => (
                <textarea
                  {...a}
                  maxLength={2000}
                  placeholder="For example: Face value changed from PKR 10 to PKR 2."
                  value={d.note}
                  onChange={(e) => setD({ ...d, note: e.target.value })}
                />
              )}
            </Field>
          </div>
          <div className="txn-summary" aria-live="polite">
            <span>Preview</span>
            {preview?.ok ? (
              <>
                <b>
                  {fmtShares(preview.before)} → {fmtShares(preview.after)} shares on {d.date}
                </b>
                <small>
                  Current: {preview.result ? fmtShares(preview.result.shares) : '—'} shares · Total cost{' '}
                  {preview.result?.cost == null ? 'unknown' : pkr(preview.result.cost)} · Average{' '}
                  {preview.result?.average == null ? 'unknown' : pkr(preview.result.average)}
                </small>
              </>
            ) : preview ? (
              <small className="field-error">{preview.message}</small>
            ) : (
              <small>Fill in the fields to see the effect on your shares.</small>
            )}
          </div>
          <DialogError
            error={submit.error}
            conflict={submit.conflict}
            onReload={() => void submit.reloadLatest()}
          />
          <div className="row dialog-actions">
            <button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save stock split'}
            </button>
            <button type="button" className="secondary" onClick={onClose}>
              Cancel
            </button>
            {editing && (
              <VoidEntryButton
                what="stock split"
                disabled={saving}
                onConfirm={() =>
                  submit.run(async () => {
                    await voidWithUndo('stockSplits', editing.id, 'Stock split voided');
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
