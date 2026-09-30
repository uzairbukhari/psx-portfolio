'use client';
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { fieldText, hasErrors, parseField, type FieldErrors } from '@/lib/forms';
import { pct } from '@/lib/format';
import { SECTORS, today, type Company } from '@/lib/portfolio';
import { clonePortfolio } from '../hooks/use-portfolio';
import { usePortfolioContext } from '../portfolio-context';
import { verifyPsxSymbol } from '../psx-symbol';
import { DialogError, Field, useSubmit } from './use-submit';

const blankCompany = (): Company => ({
  ticker: '',
  name: '',
  sector: '',
  target: 0,
  approved: false,
  screenDate: '',
  note: '',
});

export function CompanyDialog({
  ticker,
  onClose,
}: {
  /** Undefined creates a new company; a ticker edits that company. */
  ticker?: string;
  onClose: () => void;
}) {
  const { p, saving, save, toast } = usePortfolioContext();
  const submit = useSubmit();
  const creating = !ticker;
  const existing = ticker ? p.companies.find((c) => c.ticker === ticker) : undefined;
  const [c, setC] = useState<Company>(() => ({ ...(existing ?? blankCompany()) }));
  const [target, setTarget] = useState(() => fieldText(existing?.target ?? 0));
  const [faceValue, setFaceValue] = useState(() => fieldText(existing?.faceValue));

  const sectorsInUse = Array.from(
    new Set(p.companies.map((x) => x.sector).filter(Boolean)),
  );
  const targetValue = parseField(target);
  const faceValueNumber = faceValue.trim() === '' ? undefined : parseField(faceValue);
  const others = p.companies
    .filter((x) => x.ticker !== c.ticker)
    .reduce((sum, x) => sum + x.target, 0);
  const total = others + (targetValue ?? 0);

  const errors: FieldErrors<'ticker' | 'name' | 'sector' | 'target' | 'faceValue'> = {};
  if (!/^[A-Z0-9]{2,12}$/.test(c.ticker))
    errors.ticker = 'Use 2–12 capital letters or digits, as listed on PSX.';
  else if (creating && p.companies.some((x) => x.ticker === c.ticker))
    errors.ticker = `${c.ticker} is already in your portfolio.`;
  if (!c.name.trim()) errors.name = 'Enter the company name.';
  if (!c.sector) errors.sector = 'Select a sector.';
  if (targetValue === null || targetValue < 0 || targetValue > 100)
    errors.target = 'Enter a weight between 0 and 100.';
  if (faceValueNumber === null || (faceValueNumber !== undefined && (faceValueNumber < 0.01 || faceValueNumber > 1000)))
    errors.faceValue = 'Enter a face value between 0.01 and 1000, or leave blank.';
  const visible = submit.attempted ? errors : {};
  const totalOk = Math.abs(total - 100) < 0.05;

  function onSubmit(event: React.SyntheticEvent) {
    event.preventDefault();
    void submit.run(async () => {
      if (hasErrors(errors))
        throw Error('Fix the highlighted fields, then save again.');
      const next = clonePortfolio(p);
      const entry: Company = {
        ...c,
        target: targetValue!,
        faceValue: faceValueNumber ?? undefined,
      };
      if (creating) {
        next.quotes[entry.ticker] = await verifyPsxSymbol(entry.ticker);
        next.companies.push(entry);
      } else {
        const at = next.companies.findIndex((x) => x.ticker === entry.ticker);
        if (at < 0) throw Error(`${entry.ticker} no longer exists. Reload and try again.`);
        next.companies[at] = entry;
      }
      await save(next);
      onClose();
      toast({
        title: creating ? `${entry.ticker} added` : `${entry.ticker} saved`,
        description: creating ? 'Confirmed on PSX and added to your portfolio.' : undefined,
        type: 'success',
      });
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="form-dialog">
        <DialogTitle>{creating ? 'Add a company' : `Edit ${c.ticker}`}</DialogTitle>
        <DialogDescription>
          Targets are long-term portfolio weights. Confirm screening separately
          from AI analysis.
        </DialogDescription>
        <form onSubmit={onSubmit} noValidate>
          <div className="form-grid">
            <Field id="co-ticker" label="PSX symbol" error={visible.ticker}>
              {(a) => (
                <input
                  {...a}
                  autoComplete="off"
                  readOnly={!creating}
                  value={c.ticker}
                  onChange={(e) => setC({ ...c, ticker: e.target.value.toUpperCase() })}
                />
              )}
            </Field>
            <Field id="co-name" label="Company name" error={visible.name}>
              {(a) => (
                <input
                  {...a}
                  maxLength={150}
                  value={c.name}
                  onChange={(e) => setC({ ...c, name: e.target.value })}
                />
              )}
            </Field>
            <Field id="co-sector" label="Sector" error={visible.sector}>
              {(a) => (
                <select
                  {...a}
                  value={c.sector ?? ''}
                  onChange={(e) => setC({ ...c, sector: e.target.value })}
                >
                  <option value="" disabled>
                    Select sector
                  </option>
                  {Array.from(new Set([...SECTORS, ...sectorsInUse]))
                    .sort()
                    .map((sector) => (
                      <option key={sector} value={sector}>
                        {sector}
                      </option>
                    ))}
                </select>
              )}
            </Field>
            <Field
              id="co-target"
              label="Target weight (%)"
              error={visible.target}
              hint={`Targets total ${pct(total)} / 100%${totalOk ? '' : ' — they must total 100% to plan purchases.'}`}
            >
              {(a) => (
                <input
                  {...a}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  max="100"
                  step="0.1"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                />
              )}
            </Field>
            <Field id="co-face" label="Face value (Rs)" error={visible.faceValue}>
              {(a) => (
                <input
                  {...a}
                  type="number"
                  inputMode="decimal"
                  min="0.01"
                  max="1000"
                  step="0.01"
                  placeholder="10"
                  value={faceValue}
                  onChange={(e) => setFaceValue(e.target.value)}
                />
              )}
            </Field>
            <Field id="co-screen" label="Screening effective date">
              {(a) => (
                <input
                  {...a}
                  type="date"
                  max={today()}
                  value={c.screenDate}
                  onChange={(e) => setC({ ...c, screenDate: e.target.value })}
                />
              )}
            </Field>
            <div className="field wide">
              <label className="check-row" htmlFor="co-approved">
                <Checkbox
                  id="co-approved"
                  checked={c.approved}
                  onCheckedChange={(v) => setC({ ...c, approved: !!v })}
                />
                Enable new SIP purchases under the recorded Shariah screen
              </label>
            </div>
            <Field id="co-note" label="Research / screening note" wide>
              {(a) => (
                <textarea
                  {...a}
                  maxLength={2000}
                  value={c.note}
                  onChange={(e) => setC({ ...c, note: e.target.value })}
                />
              )}
            </Field>
          </div>
          <p className="muted">
            {creating
              ? 'The symbol is checked against PSX before this company is saved.'
              : 'This existing symbol has already been created in your portfolio.'}{' '}
            Screens older than 183 days pause new allocations. Total targets must
            equal 100%; the calculator caps new exposure at 20% per company.
          </p>
          <DialogError
            error={submit.error}
            conflict={submit.conflict}
            onReload={() => void submit.reloadLatest()}
          />
          <div className="row dialog-actions">
            <button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save company'}
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
