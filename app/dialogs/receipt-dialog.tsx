'use client';
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { hasErrors, parseField, type FieldErrors } from '@/lib/forms';
import {
  confirmDividendReceipt,
  today,
  type Dividend,
} from '@/lib/portfolio';
import { clonePortfolio } from '../hooks/use-portfolio';
import { usePortfolioContext } from '../portfolio-context';
import { DialogError, Field, useSubmit } from './use-submit';

export function ReceiptDialog({
  dividend,
  onClose,
}: {
  dividend: Dividend;
  onClose: () => void;
}) {
  const { p, saving, save, toast } = usePortfolioContext();
  const submit = useSubmit();
  const [d, setD] = useState({ paymentDate: today(), gross: '', tax: '' });
  // Blank means "keep PSX's expected figure / estimated tax"; anything typed must be a valid amount.
  const gross = d.gross.trim() === '' ? undefined : parseField(d.gross);
  const tax = d.tax.trim() === '' ? undefined : parseField(d.tax);

  const errors: FieldErrors<'paymentDate' | 'gross' | 'tax'> = {};
  if (!d.paymentDate) errors.paymentDate = 'Choose the payment date.';
  else if (d.paymentDate > today())
    errors.paymentDate = 'The date cannot be in the future.';
  if (gross === null || (gross !== undefined && gross < 0))
    errors.gross = 'Enter a positive amount, or leave blank.';
  if (tax === null || (tax !== undefined && tax < 0))
    errors.tax = 'Enter a positive amount, or leave blank.';
  const visible = submit.attempted ? errors : {};

  function onSubmit(event: React.SyntheticEvent) {
    event.preventDefault();
    void submit.run(async () => {
      if (hasErrors(errors))
        throw Error('Fix the highlighted fields, then save again.');
      const next = clonePortfolio(p);
      const target = next.dividends?.find((x) => x.id === dividend.id);
      if (!target)
        throw Error('That dividend no longer exists. Reload and try again.');
      Object.assign(
        target,
        confirmDividendReceipt(target, {
          paymentDate: d.paymentDate,
          grossAmount: gross ?? undefined,
          taxWithheld: tax ?? undefined,
        }),
      );
      await save(next);
      onClose();
      toast({ title: `${target.ticker} dividend marked as received`, type: 'success' });
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="form-dialog">
        <DialogTitle>Mark dividend as received</DialogTitle>
        <DialogDescription>
          Confirm that the cash arrived. Leave the amounts blank to keep PSX&apos;s
          expected figure with estimated tax, or enter what your broker / CDC
          statement shows.
        </DialogDescription>
        <form onSubmit={onSubmit} noValidate>
          <div className="form-grid">
            <Field id="receipt-ticker" label="Company symbol">
              {(a) => <input {...a} disabled value={dividend.ticker} />}
            </Field>
            <Field id="receipt-date" label="Payment date" error={visible.paymentDate}>
              {(a) => (
                <input
                  {...a}
                  type="date"
                  max={today()}
                  value={d.paymentDate}
                  onChange={(e) => setD({ ...d, paymentDate: e.target.value })}
                />
              )}
            </Field>
            <Field id="receipt-gross" label="Actual gross amount (PKR, optional)" error={visible.gross}>
              {(a) => (
                <input
                  {...a}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={d.gross}
                  onChange={(e) => setD({ ...d, gross: e.target.value })}
                />
              )}
            </Field>
            <Field id="receipt-tax" label="Tax withheld (PKR, optional)" error={visible.tax}>
              {(a) => (
                <input
                  {...a}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={d.tax}
                  onChange={(e) => setD({ ...d, tax: e.target.value })}
                />
              )}
            </Field>
          </div>
          <DialogError
            error={submit.error}
            conflict={submit.conflict}
            onReload={() => void submit.reloadLatest()}
          />
          <div className="row dialog-actions">
            <button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Mark received'}
            </button>
            <button type="button" className="secondary" onClick={onClose}>
              Cancel
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
