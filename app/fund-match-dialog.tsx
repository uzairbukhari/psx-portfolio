'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import type { FundAsset } from '@/lib/funds';
import { matchStatement } from '@/lib/fund-match';
import type { FundNavRow } from '@/lib/mufap';
import { today } from '@/lib/portfolio';

/** Matches the ledger to the units or value your bank or AMC app shows (see lib/fund-match.ts). */
export default function FundMatchDialog({
  fund,
  navs,
  busy,
  onClose,
  onSave,
}: {
  fund: FundAsset;
  navs: FundNavRow[];
  busy: boolean;
  onClose: () => void;
  onSave: (next: FundAsset, message: string) => Promise<void>;
}) {
  const [date, setDate] = useState(today());
  const [unitsText, setUnitsText] = useState('');
  const [valueText, setValueText] = useState('');
  const [error, setError] = useState('');
  const num = (t: string) => Number(t.replace(/,/g, ''));
  async function submit(event: React.SyntheticEvent) {
    event.preventDefault();
    setError('');
    const hasUnits = unitsText.trim() !== '';
    const result = matchStatement(
      fund,
      navs,
      {
        date,
        ...(hasUnits ? { units: num(unitsText) } : { value: num(valueText) }),
      },
      today(),
      `match-${new Date().toISOString().slice(0, 19)}`,
    );
    if (!result.ok) return setError(result.error);
    if (!result.changed) return setError(result.message);
    try {
      await onSave(result.fund, result.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="form-dialog tx-dialog asset-dialog">
        <DialogTitle>Match my statement</DialogTitle>
        <DialogDescription>
          Enter what your bank or fund app shows for {fund.fundName}. The
          difference is usually dividends the fund reinvested as units. Units
          are exact; a value is turned into units at that day&apos;s price.
        </DialogDescription>
        <form onSubmit={(e) => void submit(e)}>
          <label>
            Statement date
            <input
              type="date"
              value={date}
              max={today()}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </label>
          <label>
            Units shown (best)
            <input
              inputMode="decimal"
              value={unitsText}
              placeholder="e.g. 59.2122"
              onChange={(e) => setUnitsText(e.target.value)}
            />
          </label>
          <label>
            or value shown (Rs)
            <input
              inputMode="decimal"
              value={valueText}
              placeholder="e.g. 6,176"
              disabled={unitsText.trim() !== ''}
              onChange={(e) => setValueText(e.target.value)}
            />
          </label>
          {error && <p className="notice error">{error}</p>}
          <div className="dialog-actions">
            <button type="button" className="secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" disabled={busy}>
              Match
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
