'use client';
// Record the month's buys in one review: the ticket's shares and prices, editable to what your broker actually filled,
// with one tick per line and one save. Nothing is recorded until Save.
import { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { money, today } from '@/lib/portfolio';
import type { MonthlyPickEstimate } from '@/lib/monthly-picks';

export type PickBuyRow = { ticker: string; name: string; shares: number; price: number; fees: number };
export type PickDestination = { id: string; name: string; locked?: boolean };

const fee = (shares: number, price: number, pct: number) => Math.round(shares * price * (pct / 100) * 100) / 100;

export default function PicksRecordDialog({
  estimates, names, month, feePct, destinations, defaultDestination, planned, bought, busy, onClose, onSave,
}: {
  estimates: MonthlyPickEstimate[];
  names: Record<string, string>;
  month: string;
  feePct: number;
  destinations: PickDestination[];
  defaultDestination: string;
  /** The SIP Blueprint's stocks amount and what is already bought this month, when a blueprint exists. */
  planned: number | null;
  bought: number;
  busy: boolean;
  onClose: () => void;
  onSave: (rows: PickBuyRow[], options: { date: string; destinationId: string }) => Promise<void>;
}) {
  const initial = useMemo(
    () => estimates.filter((e) => (e.shares ?? 0) > 0 && (e.price ?? 0) > 0).map((e) => ({
      ticker: e.ticker, name: names[e.ticker] ?? e.name, on: true,
      shares: String(e.shares), price: String(e.price), fees: String(fee(e.shares!, e.price!, feePct)),
    })),
    [estimates, names, feePct],
  );
  const [lines, setLines] = useState(initial);
  const open = destinations.filter((d) => !d.locked);
  const [destinationId, setDestinationId] = useState(open.some((d) => d.id === defaultDestination) ? defaultDestination : (open[0]?.id ?? ''));
  const [date, setDate] = useState(today());
  const [error, setError] = useState('');
  const set = (ticker: string, patch: Partial<(typeof initial)[number]>) => setLines((rows) => rows.map((r) => (r.ticker === ticker ? { ...r, ...patch } : r)));

  const parsed = lines.map((line) => ({ ...line, n: Number(line.shares), p: Number(line.price), f: Number(line.fees) }));
  const chosen = parsed.filter((l) => l.on);
  const valid = (l: (typeof parsed)[number]) => Number.isInteger(l.n) && l.n > 0 && l.p > 0 && Number.isFinite(l.f) && l.f >= 0;
  const total = chosen.reduce((sum, l) => sum + (valid(l) ? l.n * l.p + l.f : 0), 0);
  const problem = !chosen.length ? 'Tick at least one buy.' : chosen.some((l) => !valid(l)) ? 'Shares must be a whole number and the price above zero.' : !destinationId ? 'Choose a portfolio.' : !/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today() ? 'Choose a date that is not in the future.' : '';

  async function save() {
    setError('');
    try {
      await onSave(chosen.map((l) => ({ ticker: l.ticker, name: l.name, shares: l.n, price: l.p, fees: l.f })), { date, destinationId });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="form-dialog">
        <DialogTitle>Record {month}&apos;s stock buys</DialogTitle>
        <DialogDescription>Change the shares, price and fees to what your broker actually filled. Untick anything you did not buy.</DialogDescription>
        <div className="mp2-record">
          <div className="mp2-record__meta">
            <label>
              Date
              <input type="date" value={date} max={today()} onChange={(event) => setDate(event.target.value)} />
            </label>
            {open.length > 1 && (
              <label>
                Portfolio
                <select value={destinationId} onChange={(event) => setDestinationId(event.target.value)}>
                  {open.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </label>
            )}
          </div>
          <table>
            <thead>
              <tr><th aria-label="Include" /><th>Company</th><th>Shares</th><th>Price</th><th>Fees</th><th>Total</th></tr>
            </thead>
            <tbody>
              {parsed.map((l) => (
                <tr key={l.ticker} className={l.on ? undefined : 'is-off'}>
                  <td><Checkbox aria-label={`Record ${l.ticker}`} checked={l.on} onCheckedChange={(v) => set(l.ticker, { on: v === true })} /></td>
                  <td><b>{l.ticker}</b></td>
                  <td><input type="number" min="1" step="1" aria-label={`${l.ticker} shares`} value={l.shares} onChange={(event) => set(l.ticker, { shares: event.target.value })} /></td>
                  <td><input type="number" min="0" step="any" aria-label={`${l.ticker} price`} value={l.price} onChange={(event) => set(l.ticker, { price: event.target.value })} /></td>
                  <td><input type="number" min="0" step="any" aria-label={`${l.ticker} fees`} value={l.fees} onChange={(event) => set(l.ticker, { fees: event.target.value })} /></td>
                  <td>{l.on && valid(l) ? money(l.n * l.p + l.f) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mp2-totals">
            <span>{chosen.length} {chosen.length === 1 ? 'buy' : 'buys'}</span>
            <b className="em">{money(total)}</b>
            {planned !== null && (
              <>
                <span className="muted">SIP Blueprint stocks for {month}</span>
                <b>{money(bought + total)} of {money(planned)}</b>
              </>
            )}
          </div>
          {(error || problem) && <p className={error ? 'notice error' : 'mp2-note'} role={error ? 'alert' : undefined}>{error || problem}</p>}
          <div className="row tx-actions">
            <button type="button" disabled={busy || !!problem} onClick={() => void save()}>Save {chosen.length} {chosen.length === 1 ? 'buy' : 'buys'}</button>
            <button type="button" className="secondary" onClick={onClose}>Cancel</button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
