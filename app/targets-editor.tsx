'use client';

import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { WEIGHT_CAP, today, type Portfolio } from '@/lib/portfolio';
import { applyTargets, evenWeights, screenStatus, targetRows, targetTotals } from '@/lib/targets';

type Draft = { ticker: string; weight: string; approved: boolean; screenDate: string };

const weightOf = (text: string) => (text.trim() === '' ? 0 : Number(text));

/** Edit which companies the monthly SIP splits money across, and their target weights. */
export default function TargetsEditor({
  portfolio,
  open,
  busy,
  onOpenChange,
  onSave,
}: {
  portfolio: Portfolio;
  open: boolean;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (next: Portfolio, message: string) => Promise<void>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="form-dialog">
        <DialogTitle>Target weights</DialogTitle>
        <DialogDescription>
          Monthly money goes first to the companies furthest below their target. Weights must add up to 100%, and
          the calculator caps new exposure at {WEIGHT_CAP}% per company.
        </DialogDescription>
        <TargetsForm portfolio={portfolio} busy={busy} onSave={onSave} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function TargetsForm({
  portfolio,
  busy,
  onSave,
  onDone,
}: {
  portfolio: Portfolio;
  busy: boolean;
  onSave: (next: Portfolio, message: string) => Promise<void>;
  onDone: () => void;
}) {
  const [rows, setRows] = useState<Draft[]>(() =>
    targetRows(portfolio).map((r) => ({
      ticker: r.ticker,
      weight: String(r.target),
      approved: r.approved,
      screenDate: r.screenDate,
    })),
  );
  const [adding, setAdding] = useState('');
  const [error, setError] = useState('');
  const totals = targetTotals(rows.map((r) => ({ ticker: r.ticker, target: weightOf(r.weight) })));
  const names = new Map(portfolio.companies.map((c) => [c.ticker, c.name]));
  const available = portfolio.companies.filter((c) => !rows.some((r) => r.ticker === c.ticker));
  const patch = (ticker: string, change: Partial<Draft>) =>
    setRows((list) => list.map((r) => (r.ticker === ticker ? { ...r, ...change } : r)));

  function spreadEvenly() {
    const weights = evenWeights(rows.length);
    setRows((list) => list.map((r, i) => ({ ...r, weight: String(weights[i]) })));
  }
  async function submit(event: { preventDefault: () => void }) {
    event.preventDefault();
    setError('');
    try {
      const next = applyTargets(
        portfolio,
        rows.map((r) => ({
          ticker: r.ticker,
          target: weightOf(r.weight),
          approved: r.approved,
          screenDate: r.screenDate,
        })),
      );
      await onSave(next, 'Target weights saved.');
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const tone = totals.status === 'exact' ? 'success' : totals.status === 'over' ? 'error' : 'notice';
  return (
    <form onSubmit={submit}>
      <output className={`${tone} targets-total`}>
        <strong>Total {totals.total}%</strong>
        <span>
          {totals.status === 'exact'
            ? 'Ready to save.'
            : totals.status === 'over'
              ? `${-totals.remaining}% over 100%.`
              : `${totals.remaining}% still to allocate.`}
        </span>
      </output>
      {!!totals.overCap.length && (
        <p className="muted targets-cap">
          {totals.overCap.join(', ')} {totals.overCap.length === 1 ? 'is' : 'are'} above {WEIGHT_CAP}%. The
          calculator treats {totals.overCap.length === 1 ? 'it' : 'them'} as {WEIGHT_CAP}% when it works out new
          purchases.
        </p>
      )}
      {rows.length === 0 && <p className="muted">No companies yet. Add the ones you want the monthly SIP to buy.</p>}
      <ul className="targets-list">
        {rows.map((r) => {
          const status = screenStatus({ approved: r.approved, screenDate: r.screenDate });
          return (
            <li key={r.ticker}>
              <div className="targets-head">
                <span>
                  <b>{r.ticker}</b> <small title={names.get(r.ticker)}>{names.get(r.ticker)}</small>
                </span>
                <button
                  type="button"
                  className="secondary compact"
                  aria-label={`Remove ${r.ticker} from targets`}
                  onClick={() => setRows((list) => list.filter((x) => x.ticker !== r.ticker))}
                >
                  <X size={14} />
                </button>
              </div>
              <div className="targets-fields">
                <label>
                  Weight (%)
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    max="100"
                    step="0.1"
                    value={r.weight}
                    onChange={(e) => patch(r.ticker, { weight: e.target.value })}
                  />
                </label>
                <label>
                  Screening effective date
                  <input
                    type="date"
                    max={today()}
                    value={r.screenDate}
                    onChange={(e) => patch(r.ticker, { screenDate: e.target.value })}
                  />
                </label>
              </div>
              <label className="check-row" htmlFor={`approved-${r.ticker}`}>
                <Checkbox id={`approved-${r.ticker}`} checked={r.approved} onCheckedChange={(v) => patch(r.ticker, { approved: !!v })} />
                Enable new SIP purchases under the recorded Shariah screen
              </label>
              <p className={status.state === 'valid' ? 'muted targets-screen' : 'targets-screen targets-screen--warn'}>
                {status.label}
              </p>
            </li>
          );
        })}
      </ul>
      <div className="row targets-add">
        <select aria-label="Add company" value={adding} disabled={!available.length} onChange={(e) => setAdding(e.target.value)}>
          <option value="">{available.length ? 'Add a company…' : 'Every company is already here'}</option>
          {available.map((c) => (
            <option key={c.ticker} value={c.ticker}>
              {c.ticker} · {c.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="secondary compact"
          disabled={!adding}
          onClick={() => {
            setRows((list) => [...list, { ticker: adding, weight: '', approved: false, screenDate: '' }]);
            setAdding('');
          }}
        >
          <Plus size={14} /> Add
        </button>
        <button type="button" className="secondary compact" disabled={rows.length < 2} onClick={spreadEvenly}>
          Spread evenly
        </button>
      </div>
      <p className="muted">
        A company that is not listed here yet can be added from Your companies first. Screens older than 183 days
        pause new allocations.
      </p>
      {error && <div className="notice error">{error}</div>}
      <button disabled={busy || totals.status !== 'exact'}>Save targets</button>
    </form>
  );
}
