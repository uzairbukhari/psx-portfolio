'use client';

import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  dueEntries,
  newPlanId,
  PAK_QATAR_MIN_FIRST,
  PAK_QATAR_MIN_TOPUP,
  PAK_QATAR_PLAN_NAME,
  planValue,
  type PlanAsset,
} from '@/lib/plans';
import { money, moneyShort, today } from '@/lib/portfolio';

export type OwnedPlan = { asset: PlanAsset; portfolioName?: string };
type Mode =
  | { kind: 'plan' }
  | { kind: 'contribution' | 'redeem' | 'value' | 'monthly'; planId: string };

const tone = (n: number | null) =>
  n === null ? '' : n >= 0 ? 'pos-text' : 'neg-text';
const signed = (n: number) => `${n >= 0 ? '+' : '−'}${moneyShort(Math.abs(n))}`;
const dateText = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
const monthText = (month: string) =>
  new Date(`${month}-15T12:00:00Z`).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
const id = () =>
  `r-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;

/**
 * Savings plans such as Pak-Qatar's Mahana Bachat. The value is the one your statement or the provider's app shows,
 * dated; between statements it is clearly marked as an estimate. Gains stay in the plan, and cash you redeem is kept
 * in the history and counts as money back to you. Read-only in the All view.
 */
export default function SavingsPlansSection({
  owned,
  canEdit,
  busy,
  onChange,
}: {
  owned: OwnedPlan[];
  canEdit: boolean;
  busy: boolean;
  /** Receives this portfolio's complete plan list after any change. */
  onChange: (plans: PlanAsset[], message: string) => Promise<void>;
}) {
  const asOf = today();
  const [mode, setMode] = useState<Mode | null>(null);
  const [error, setError] = useState('');
  const plans = owned.map((o) => o.asset);
  const rows = useMemo(
    () =>
      owned.map((o) => ({
        ...o,
        v: planValue(o.asset, asOf),
        due: dueEntries(o.asset, asOf),
      })),
    [owned, asOf],
  );

  async function update(
    planId: string,
    change: (plan: PlanAsset) => PlanAsset,
    message: string,
  ) {
    setError('');
    await onChange(
      plans.map((p) => (p.id === planId ? change(p) : p)),
      message,
    ).catch((e: unknown) =>
      setError(e instanceof Error ? e.message : String(e)),
    );
  }

  return (
    <section className="panel metal-section" aria-label="Savings plans">
      <div className="holdings-head">
        <h2>
          Savings plans
          <span className="count-badge">
            {rows.filter((r) => !r.asset.closed).length} active
          </span>
        </h2>
        {canEdit && (
          <button
            type="button"
            className="secondary compact holdings-add"
            disabled={busy}
            onClick={() => setMode({ kind: 'plan' })}
          >
            <Plus size={15} />{' '}
            <span className="holdings-add__label">Add a savings plan</span>
          </button>
        )}
      </div>
      {error && <p className="notice error">{error}</p>}
      {rows.length === 0 ? (
        <p className="muted">
          Track Pak-Qatar Mahana Bachat or any plan where you pay in and the
          provider reports a value. Gains stay inside the plan; cash you redeem
          is recorded.
        </p>
      ) : (
        rows.map(({ asset, v, due, portfolioName }) => (
          <article
            className="metal-asset"
            key={`${asset.id}-${portfolioName ?? ''}`}
          >
            <header className="metal-asset__head">
              <div>
                <b>{asset.name}</b>
                <small>
                  {asset.provider === 'pak-qatar-mbp'
                    ? 'Pak-Qatar Family Takaful'
                    : 'Savings plan'}
                  {asset.closed ? ' · closed' : ''}
                  {portfolioName ? ` · ${portfolioName}` : ''}
                </small>
              </div>
              <div className="metal-asset__value amount">
                {moneyShort(v.value)}
                <small className={tone(v.gain)}>
                  {signed(v.gain)}
                  {v.gainPercent === null
                    ? ''
                    : ` · ${v.gainPercent >= 0 ? '+' : '−'}${Math.abs(v.gainPercent).toFixed(1)}%`}
                </small>
              </div>
            </header>
            <dl className="metal-asset__stats">
              <div>
                <dt>Paid in</dt>
                <dd>{moneyShort(v.contributed)}</dd>
              </div>
              <div>
                <dt>Cash redeemed</dt>
                <dd>{moneyShort(v.redeemed)}</dd>
              </div>
              <div>
                <dt>Still in the plan</dt>
                <dd>{moneyShort(v.cost)}</dd>
              </div>
              <div>
                <dt>Gain (incl. redeemed)</dt>
                <dd className={tone(v.gain)}>{signed(v.gain)}</dd>
              </div>
            </dl>
            <p className="report-source">
              {v.source === 'statement' &&
                `Value from your statement of ${dateText(v.statementDate!)}.`}
              {v.source === 'estimate' &&
                `Estimated from your statement of ${dateText(v.statementDate!)}${asset.assumedAnnualRate ? ` grown at ${(asset.assumedAnnualRate * 100).toFixed(1)}% a year` : ''} plus what you paid in and took out since. Enter the latest statement value to correct it.`}
              {v.source === 'paid-in' &&
                'No statement value yet, so the plan is shown at the amount paid in. Enter the value from your statement or app.'}
            </p>
            {due.length > 0 && canEdit && (
              <div className="notice">
                <b>Due:</b>
                {due.map((d) => (
                  <span key={`${d.ruleId}-${d.month}`} className="row">
                    {monthText(d.month)} · {money(d.amount)}
                    <button
                      type="button"
                      className="compact"
                      disabled={busy}
                      onClick={() =>
                        void update(
                          asset.id,
                          (p) => ({
                            ...p,
                            entries: [
                              ...p.entries,
                              {
                                id: id(),
                                type: 'contribution',
                                date: d.date,
                                amount: d.amount,
                                recurringId: d.ruleId,
                                note: 'Monthly contribution',
                              },
                            ],
                          }),
                          'Contribution recorded.',
                        )
                      }
                    >
                      Confirm paid
                    </button>
                    <button
                      type="button"
                      className="secondary compact"
                      disabled={busy}
                      onClick={() =>
                        void update(
                          asset.id,
                          (p) => ({
                            ...p,
                            rules: p.rules.map((r) =>
                              r.id === d.ruleId
                                ? { ...r, skipped: [...r.skipped, d.month] }
                                : r,
                            ),
                          }),
                          'Month skipped.',
                        )
                      }
                    >
                      Skip
                    </button>
                  </span>
                ))}
              </div>
            )}
            {due.length > 0 && !canEdit && (
              <p className="report-source">
                {due.length} monthly contribution{due.length === 1 ? '' : 's'}{' '}
                due. Open this portfolio to confirm.
              </p>
            )}
            {canEdit && !asset.closed && (
              <div className="row">
                <button
                  type="button"
                  className="compact"
                  disabled={busy}
                  onClick={() =>
                    setMode({ kind: 'contribution', planId: asset.id })
                  }
                >
                  Pay in
                </button>
                <button
                  type="button"
                  className="secondary compact"
                  disabled={busy}
                  onClick={() => setMode({ kind: 'redeem', planId: asset.id })}
                >
                  Redeem cash
                </button>
                <button
                  type="button"
                  className="secondary compact"
                  disabled={busy}
                  onClick={() => setMode({ kind: 'value', planId: asset.id })}
                >
                  Update value
                </button>
                <button
                  type="button"
                  className="secondary compact"
                  disabled={busy}
                  onClick={() => setMode({ kind: 'monthly', planId: asset.id })}
                >
                  Monthly contribution
                </button>
              </div>
            )}
            {asset.rules
              .filter((r) => !r.stopped)
              .map((r) => (
                <p key={r.id} className="report-source">
                  Monthly: {money(r.amount)} on day {r.dayOfMonth} from{' '}
                  {monthText(r.from)}
                  {canEdit && (
                    <>
                      {' · '}
                      <button
                        type="button"
                        className="link-button"
                        onClick={() =>
                          void update(
                            asset.id,
                            (p) => ({
                              ...p,
                              rules: p.rules.map((x) =>
                                x.id === r.id ? { ...x, stopped: true } : x,
                              ),
                            }),
                            'Monthly contribution stopped.',
                          )
                        }
                      >
                        Stop
                      </button>
                    </>
                  )}
                </p>
              ))}
            <details className="metal-history">
              <summary>
                History ({asset.entries.length + asset.valuations.length}{' '}
                records)
              </summary>
              <div className="scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Record</th>
                      <th>Amount</th>
                      {canEdit && <th aria-label="Actions" />}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ...asset.entries.map((e) => ({
                        key: e.id,
                        date: e.date,
                        label:
                          e.type === 'contribution'
                            ? 'Paid in'
                            : 'Cash redeemed',
                        amount: e.amount,
                        voided: !!e.voided,
                        note: e.note,
                        kind: 'entry' as const,
                      })),
                      ...asset.valuations.map((x) => ({
                        key: x.id,
                        date: x.date,
                        label: 'Statement value',
                        amount: x.value,
                        voided: !!x.voided,
                        note: x.note,
                        kind: 'value' as const,
                      })),
                    ]
                      .sort((a, b) =>
                        a.date < b.date ? 1 : a.date > b.date ? -1 : 0,
                      )
                      .map((row) => (
                        <tr
                          key={row.key}
                          className={row.voided ? 'voided' : undefined}
                        >
                          <td>{dateText(row.date)}</td>
                          <td>
                            {row.label}
                            {row.voided ? ' · voided' : ''}
                            {row.note ? <small>{row.note}</small> : null}
                          </td>
                          <td className="amount">{money(row.amount)}</td>
                          {canEdit && (
                            <td>
                              <button
                                type="button"
                                className="secondary compact"
                                disabled={busy}
                                onClick={() =>
                                  void update(
                                    asset.id,
                                    (p) =>
                                      row.kind === 'entry'
                                        ? {
                                            ...p,
                                            entries: p.entries.map((e) =>
                                              e.id === row.key
                                                ? { ...e, voided: !e.voided }
                                                : e,
                                            ),
                                          }
                                        : {
                                            ...p,
                                            valuations: p.valuations.map((x) =>
                                              x.id === row.key
                                                ? { ...x, voided: !x.voided }
                                                : x,
                                            ),
                                          },
                                    'Record updated.',
                                  )
                                }
                              >
                                {row.voided ? 'Restore' : 'Void'}
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </details>
          </article>
        ))
      )}
      {mode && (
        <PlanDialog
          mode={mode}
          plans={plans}
          busy={busy}
          onClose={() => setMode(null)}
          onSave={async (next, message) => {
            await onChange(next, message);
            setMode(null);
          }}
        />
      )}
    </section>
  );
}

function PlanDialog({
  mode,
  plans,
  busy,
  onClose,
  onSave,
}: {
  mode: Mode;
  plans: PlanAsset[];
  busy: boolean;
  onClose: () => void;
  onSave: (plans: PlanAsset[], message: string) => Promise<void>;
}) {
  const plan =
    mode.kind === 'plan' ? undefined : plans.find((p) => p.id === mode.planId);
  const [provider, setProvider] =
    useState<PlanAsset['provider']>('pak-qatar-mbp');
  const [name, setName] = useState(PAK_QATAR_PLAN_NAME);
  const [date, setDate] = useState(today());
  const [amount, setAmount] = useState('');
  const [value, setValue] = useState('');
  const [rate, setRate] = useState('');
  const [day, setDay] = useState('5');
  const [from, setFrom] = useState(today().slice(0, 7));
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const titles = {
    plan: 'Add a savings plan',
    contribution: 'Pay in to the plan',
    redeem: 'Redeem cash from the plan',
    value: 'Update the plan value',
    monthly: 'Monthly contribution',
  } as const;
  const number = (text: string) => Number(text.replace(/,/g, ''));

  async function submit(event: React.SyntheticEvent) {
    event.preventDefault();
    setError('');
    try {
      if (mode.kind === 'plan') {
        if (!name.trim()) throw new Error('Enter a name.');
        const pct = rate.trim() === '' ? undefined : number(rate) / 100;
        if (pct !== undefined && !(pct >= 0 && pct <= 1))
          throw new Error(
            'Enter the assumed yearly return as a percentage, like 12.',
          );
        const first = amount.trim() === '' ? null : number(amount);
        if (first !== null && !(first > 0))
          throw new Error(
            'Enter the amount you first paid in, or leave it empty.',
          );
        const created: PlanAsset = {
          id: newPlanId(),
          kind: 'plan',
          name: name.trim(),
          provider,
          note: note.trim(),
          ...(pct === undefined ? {} : { assumedAnnualRate: pct }),
          entries:
            first === null
              ? []
              : [
                  {
                    id: id(),
                    type: 'contribution',
                    date,
                    amount: first,
                    note: 'First contribution',
                  },
                ],
          valuations: [],
          rules: [],
        };
        await onSave([...plans, created], 'Savings plan added.');
        return;
      }
      if (!plan) throw new Error('That plan no longer exists.');
      let next: PlanAsset;
      let message: string;
      if (mode.kind === 'value') {
        const v = number(value);
        if (!(v >= 0) || value.trim() === '')
          throw new Error('Enter the value from your statement or app.');
        next = {
          ...plan,
          valuations: [
            ...plan.valuations,
            { id: id(), date, value: v, note: note.trim() },
          ],
          closed:
            v === 0 && plan.entries.some((e) => e.type === 'redeem')
              ? true
              : plan.closed,
        };
        message = 'Plan value updated.';
      } else if (mode.kind === 'monthly') {
        const a = number(amount);
        const d = Math.floor(number(day));
        if (!(a > 0)) throw new Error('Enter the monthly amount.');
        next = {
          ...plan,
          rules: [
            ...plan.rules,
            { id: id(), dayOfMonth: d, amount: a, from, skipped: [] },
          ],
        };
        message = 'Monthly contribution set.';
      } else {
        const a = number(amount);
        if (!(a > 0))
          throw new Error(
            mode.kind === 'redeem'
              ? 'Enter the cash you received.'
              : 'Enter the amount you paid in.',
          );
        if (
          mode.kind === 'contribution' &&
          plan.provider === 'pak-qatar-mbp' &&
          a < PAK_QATAR_MIN_TOPUP &&
          plan.entries.length
        )
          throw new Error(
            `Pak-Qatar's smallest top-up is ${money(PAK_QATAR_MIN_TOPUP)}.`,
          );
        next = {
          ...plan,
          entries: [
            ...plan.entries,
            { id: id(), type: mode.kind, date, amount: a, note: note.trim() },
          ],
        };
        message =
          mode.kind === 'redeem'
            ? 'Redemption recorded.'
            : 'Contribution recorded.';
      }
      await onSave(
        plans.map((p) => (p.id === plan.id ? next : p)),
        message,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="form-dialog tx-dialog">
        <DialogTitle>{titles[mode.kind]}</DialogTitle>
        <DialogDescription>
          {mode.kind === 'plan'
            ? `Pak-Qatar's plan needs at least ${money(PAK_QATAR_MIN_FIRST)} to start and top-ups from ${money(PAK_QATAR_MIN_TOPUP)}. Gains stay in the plan.`
            : mode.kind === 'value'
              ? 'Enter the value your statement or the provider’s app shows today. This is the number the dashboard trusts.'
              : mode.kind === 'monthly'
                ? 'Each month it comes due you confirm that you paid, or skip it. Nothing counts until you confirm.'
                : 'Kept in the history; you can void it later.'}
        </DialogDescription>
        <form onSubmit={(e) => void submit(e)}>
          <div className="form-grid">
            {mode.kind === 'plan' && (
              <>
                <label>
                  Plan
                  <select
                    value={provider}
                    onChange={(e) => {
                      const next = e.target.value as PlanAsset['provider'];
                      setProvider(next);
                      setName(
                        next === 'pak-qatar-mbp' ? PAK_QATAR_PLAN_NAME : '',
                      );
                    }}
                  >
                    <option value="pak-qatar-mbp">
                      Pak-Qatar Mahana Bachat
                    </option>
                    <option value="other">Another savings plan</option>
                  </select>
                </label>
                <label>
                  Name
                  <input
                    value={name}
                    maxLength={80}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
              </>
            )}
            {mode.kind !== 'monthly' && (
              <label>
                {mode.kind === 'plan' ? 'Date of first payment' : 'Date'}
                <input
                  type="date"
                  value={date}
                  max={today()}
                  onChange={(e) => setDate(e.target.value)}
                  required
                />
              </label>
            )}
            {mode.kind === 'value' ? (
              <label>
                Value today (Rs)
                <input
                  inputMode="decimal"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                />
              </label>
            ) : (
              <label>
                {mode.kind === 'redeem'
                  ? 'Cash received (Rs)'
                  : mode.kind === 'monthly'
                    ? 'Monthly amount (Rs)'
                    : mode.kind === 'plan'
                      ? 'First amount paid in (Rs), optional'
                      : 'Amount paid in (Rs)'}
                <input
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>
            )}
            {mode.kind === 'monthly' && (
              <>
                <label>
                  Day of the month (1 to 28)
                  <input
                    inputMode="numeric"
                    value={day}
                    onChange={(e) => setDay(e.target.value)}
                  />
                </label>
                <label>
                  Starting month
                  <input
                    type="month"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                  />
                </label>
              </>
            )}
            {mode.kind === 'plan' && (
              <label className="wide">
                Assumed yearly return % (optional, only used to estimate between
                statements)
                <input
                  inputMode="decimal"
                  value={rate}
                  placeholder="e.g. 12"
                  onChange={(e) => setRate(e.target.value)}
                />
              </label>
            )}
            {mode.kind !== 'monthly' && (
              <label className="wide">
                Note
                <input
                  value={note}
                  maxLength={500}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
            )}
          </div>
          {error && <p className="notice error">{error}</p>}
          <div className="row tx-actions">
            <button type="submit" disabled={busy}>
              Save
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
