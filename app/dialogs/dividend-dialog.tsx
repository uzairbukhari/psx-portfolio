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
import { addNotifications, dividendNotifications } from '@/lib/notifications';
import {
  round,
  sharesHeldOn,
  today,
  type Dividend,
} from '@/lib/portfolio';
import { clonePortfolio } from '../hooks/use-portfolio';
import { usePortfolioContext } from '../portfolio-context';
import { DialogError, Field, useSubmit } from './use-submit';
import { VoidEntryButton, useVoidWithUndo } from './void-entry';

/** Correcting an automatic PSX record turns it into a manual one the user owns. */
function correctionBase(d: Dividend): Dividend {
  return d.source === 'auto'
    ? {
        ...d,
        source: 'manual',
        externalId: undefined,
        status: undefined,
        entitlementDate: undefined,
        entitlementCertain: undefined,
        paymentDate: undefined,
      }
    : { ...d };
}

export function DividendDialog({
  ticker,
  editing,
  onClose,
}: {
  ticker?: string;
  editing?: Dividend;
  onClose: () => void;
}) {
  const { p, saving, save, toast, goTab } = usePortfolioContext();
  const voidWithUndo = useVoidWithUndo();
  const submit = useSubmit();
  const [d, setD] = useState(() => ({
    ticker: editing?.ticker ?? ticker ?? '',
    date: editing?.date ?? today(),
    perShare: fieldText(editing?.perShare),
    note: editing?.note ?? '',
  }));

  const known = p.companies.some((c) => c.ticker === d.ticker);
  const perShare = parseField(d.perShare);
  const held = known && d.date ? sharesHeldOn(p, d.ticker, d.date) : null;
  const gross = perShare !== null && held !== null ? round(perShare * held) : null;
  const rate = p.taxProfile
    ? p.taxProfile.filerStatus === 'filer'
      ? 0.15
      : 0.3
    : null;

  const errors: FieldErrors<'ticker' | 'date' | 'perShare'> = {};
  if (!d.ticker) errors.ticker = 'Enter the PSX symbol.';
  else if (!known) errors.ticker = `${d.ticker} is not in your companies.`;
  if (!d.date) errors.date = 'Choose the payment date.';
  else if (d.date > today()) errors.date = 'The date cannot be in the future.';
  if (perShare === null) errors.perShare = 'Enter the dividend per share.';
  else if (perShare < 0) errors.perShare = 'The amount cannot be negative.';
  else if (held === 0 && known)
    errors.perShare = `You held no ${d.ticker} shares on ${d.date}.`;
  const visible = submit.attempted ? errors : {};

  function onSubmit(event: React.SyntheticEvent) {
    event.preventDefault();
    void submit.run(async () => {
      if (hasErrors(errors))
        throw Error('Fix the highlighted fields, then save again.');
      const next = clonePortfolio(p);
      const base = editing ? correctionBase(editing) : undefined;
      const { voided: _voided, ...carried } = base ?? ({} as Partial<Dividend>);
      const entry: Dividend = {
        ...carried,
        id: crypto.randomUUID(),
        ticker: d.ticker,
        date: d.date,
        source: base?.source ?? 'manual',
        perShare: perShare!,
        grossAmount: round(perShare! * sharesHeldOn(next, d.ticker, d.date)),
        note: d.note,
      };
      next.dividends = replaceEntry(next.dividends ?? [], editing?.id, entry);
      addNotifications(
        next,
        dividendNotifications([entry], new Date().toISOString()),
      );
      await save(next);
      onClose();
      toast({
        title: editing ? 'Correction saved' : 'Dividend recorded',
        description: editing ? 'Previous dividend record retained as voided.' : undefined,
        type: 'success',
        action: { label: 'View in log', onClick: () => goTab('history') },
      });
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="form-dialog">
        <DialogTitle>{editing ? 'Correct dividend' : 'Record a dividend'}</DialogTitle>
        <DialogDescription>
          Enter the per-share amount from your dividend notice. The gross amount
          is computed from the shares you held on the payment date.
        </DialogDescription>
        <form onSubmit={onSubmit} noValidate>
          <div className="form-grid">
            <Field id="div-ticker" label="Company symbol" error={visible.ticker}>
              {(a) => (
                <>
                  <input
                    {...a}
                    list="div-symbols"
                    autoComplete="off"
                    disabled={!!editing || !!ticker}
                    value={d.ticker}
                    onChange={(e) => setD({ ...d, ticker: e.target.value.toUpperCase() })}
                  />
                  <datalist id="div-symbols">
                    {p.companies.map((c) => (
                      <option key={c.ticker} value={c.ticker}>
                        {c.name}
                      </option>
                    ))}
                  </datalist>
                </>
              )}
            </Field>
            <Field id="div-date" label="Payment date" error={visible.date}>
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
            <Field id="div-per-share" label="Dividend per share (PKR)" error={visible.perShare}>
              {(a) => (
                <input
                  {...a}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={d.perShare}
                  onChange={(e) => setD({ ...d, perShare: e.target.value })}
                />
              )}
            </Field>
            <Field id="div-note" label="Note" wide>
              {(a) => (
                <textarea
                  {...a}
                  maxLength={2000}
                  value={d.note}
                  onChange={(e) => setD({ ...d, note: e.target.value })}
                />
              )}
            </Field>
          </div>
          <div className="txn-summary" aria-live="polite">
            <span>Summary</span>
            <b>
              {held === null
                ? 'Choose a company to see your shares held.'
                : `${fmtShares(held)} shares held on ${d.date}`}
            </b>
            <small>
              {gross === null
                ? 'Enter the dividend per share to see the amount.'
                : rate === null
                  ? `Gross ${pkr(gross)} · Set your filer status in Settings to estimate tax.`
                  : `Gross ${pkr(gross)} · Estimated tax ${pkr(round(gross * rate))} · Estimated net ${pkr(round(gross * (1 - rate)))}`}
            </small>
          </div>
          <DialogError
            error={submit.error}
            conflict={submit.conflict}
            onReload={() => void submit.reloadLatest()}
          />
          <div className="row dialog-actions">
            <button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save dividend'}
            </button>
            <button type="button" className="secondary" onClick={onClose}>
              Cancel
            </button>
            {editing && (
              <VoidEntryButton
                what="dividend"
                disabled={saving}
                onConfirm={() =>
                  submit.run(async () => {
                    await voidWithUndo('dividends', editing.id, 'Dividend record voided');
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
