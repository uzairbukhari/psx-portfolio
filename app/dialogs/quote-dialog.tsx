'use client';
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { fieldText, hasErrors, parseField, type FieldErrors } from '@/lib/forms';
import { today } from '@/lib/portfolio';
import { usePortfolioContext } from '../portfolio-context';
import { DialogError, Field, useSubmit } from './use-submit';

export function QuoteDialog({
  ticker,
  onClose,
}: {
  ticker: string;
  onClose: () => void;
}) {
  const { p, saving, save, toast } = usePortfolioContext();
  const submit = useSubmit();
  const [d, setD] = useState(() => ({
    price: fieldText(p.quotes[ticker]?.price),
    date: p.quotes[ticker]?.date ?? today(),
  }));
  const price = parseField(d.price);

  const errors: FieldErrors<'price' | 'date'> = {};
  if (price === null) errors.price = 'Enter the price per share.';
  else if (price <= 0) errors.price = 'The price must be above zero.';
  if (!d.date) errors.date = 'Choose the quote date.';
  else if (d.date > today()) errors.date = 'The date cannot be in the future.';
  const visible = submit.attempted ? errors : {};

  function onSubmit(event: React.SyntheticEvent) {
    event.preventDefault();
    void submit.run(async () => {
      if (hasErrors(errors))
        throw Error('Fix the highlighted fields, then save again.');
      await save({
        ...p,
        quotes: {
          ...p.quotes,
          [ticker]: {
            price: price!,
            date: d.date,
            asOf: d.date + ' · manually entered',
            manual: true,
            source: 'https://dps.psx.com.pk/company/' + ticker,
            fetchedAt: new Date().toISOString(),
          },
        },
      });
      onClose();
      toast({ title: `${ticker} price saved`, description: 'Marked as a manual price.', type: 'success' });
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="form-dialog">
        <DialogTitle>{ticker} price</DialogTitle>
        <DialogDescription>
          Enter a verified market price and its actual date.
        </DialogDescription>
        <form onSubmit={onSubmit} noValidate>
          <div className="form-grid">
            <Field id="quote-price" label="Price per share (PKR)" error={visible.price}>
              {(a) => (
                <input
                  {...a}
                  type="number"
                  inputMode="decimal"
                  min="0.0001"
                  step="any"
                  value={d.price}
                  onChange={(e) => setD({ ...d, price: e.target.value })}
                />
              )}
            </Field>
            <Field id="quote-date" label="Quote date" error={visible.date}>
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
          </div>
          <p>
            <a
              target="_blank"
              rel="noreferrer"
              href={'https://dps.psx.com.pk/company/' + ticker}
            >
              Check official PSX quote ↗
            </a>
          </p>
          <DialogError
            error={submit.error}
            conflict={submit.conflict}
            onReload={() => void submit.reloadLatest()}
          />
          <div className="row dialog-actions">
            <button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save manual price'}
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
