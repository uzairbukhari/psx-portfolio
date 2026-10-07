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
  PAK_QATAR_SUBFUNDS,
  type PlanNavRow,
  planValue,
  type PlanAsset,
} from '@/lib/plans';
import { money, moneyShort, today } from '@/lib/portfolio';
import AssetHistory, { type HistoryRow } from './asset-history';
import CollapsiblePanel from './collapsible-panel';
import { track } from './analytics';

export type OwnedPlan = { asset: PlanAsset; portfolioName?: string };
type Mode =
  | { kind: 'plan' }
  | {
      kind: 'contribution' | 'redeem' | 'value' | 'monthly';
      planId: string;
      /** The history record being corrected, when editing rather than adding. */
      editId?: string;
    };

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
function planHistoryRows(
  asset: PlanAsset,
  canEdit: boolean,
  busy: boolean,
  update: (
    planId: string,
    change: (plan: PlanAsset) => PlanAsset,
    message: string,
  ) => Promise<void>,
  edit: (kind: 'contribution' | 'redeem' | 'value', id: string) => void,
): HistoryRow[] {
  const toggle = (kind: 'entry' | 'value', key: string) =>
    void update(
      asset.id,
      (p) =>
        kind === 'entry'
          ? {
              ...p,
              entries: p.entries.map((e) =>
                e.id === key ? { ...e, voided: !e.voided } : e,
              ),
            }
          : {
              ...p,
              valuations: p.valuations.map((x) =>
                x.id === key ? { ...x, voided: !x.voided } : x,
              ),
            },
      'Record updated.',
    );
  const rows: (HistoryRow & { sort: string })[] = [
    ...asset.entries.map((e) => ({
      id: e.id,
      sort: e.date,
      date: dateText(e.date),
      tag: e.type === 'contribution' ? ('buy' as const) : ('sell' as const),
      tagLabel: e.type === 'contribution' ? 'Paid in' : 'Redeemed',
      title:
        e.type === 'contribution'
          ? 'Contribution to the plan'
          : 'Cash taken out',
      note: e.load
        ? `Load ${money(e.load)} · ${money(e.amount - e.load)} invested`
        : e.note || undefined,
      amount: `${e.type === 'contribution' ? '−' : '+'}${money(e.amount)}`,
      amountTone: e.type === 'contribution' ? '' : 'pos-text',
      voided: !!e.voided,
      action: canEdit
        ? {
            label: e.voided ? 'Restore' : 'Void',
            disabled: busy,
            onClick: () => toggle('entry', e.id),
          }
        : undefined,
      edit: canEdit
        ? { disabled: busy, onClick: () => edit(e.type, e.id) }
        : undefined,
    })),
    ...asset.valuations.map((x) => ({
      id: x.id,
      sort: x.date,
      date: dateText(x.date),
      tag: 'value' as const,
      tagLabel: 'Statement',
      title: 'Value from your statement',
      note: x.note || undefined,
      amount: money(x.value),
      voided: !!x.voided,
      action: canEdit
        ? {
            label: x.voided ? 'Restore' : 'Void',
            disabled: busy,
            onClick: () => toggle('value', x.id),
          }
        : undefined,
      edit: canEdit
        ? { disabled: busy, onClick: () => edit('value', x.id) }
        : undefined,
    })),
  ];
  return rows.sort((a, b) => (a.sort < b.sort ? 1 : a.sort > b.sort ? -1 : 0));
}

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
  addRequest = 0,
  planNavs = [],
  planNavsError = '',
  onChange,
}: {
  owned: OwnedPlan[];
  /** Pak-Qatar sub-fund unit prices; they move a plan's value between statements. */
  planNavs?: PlanNavRow[];
  /** Why the unit prices could not be loaded, when they could not. */
  planNavsError?: string;
  canEdit: boolean;
  busy: boolean;
  /** Bumped by the page's + menu to open the add dialog. */
  addRequest?: number;
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
        v: planValue(o.asset, asOf, planNavs),
        due: dueEntries(o.asset, asOf),
      })),
    [owned, asOf, planNavs],
  );

  // Open the add dialog when the page's + menu asks for it (set during render, not in an effect).
  const [seenRequest, setSeenRequest] = useState(addRequest);
  if (addRequest !== seenRequest) {
    setSeenRequest(addRequest);
    if (addRequest > 0 && canEdit) setMode({ kind: 'plan' });
  }
  const totals = useMemo(
    () => ({
      value: rows.reduce((a, r) => a + r.v.value, 0),
      cost: rows.reduce((a, r) => a + r.v.cost, 0),
      gain: rows.reduce((a, r) => a + r.v.gain, 0),
      active: rows.filter((r) => !r.asset.closed).length,
    }),
    [rows],
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

  const dialog = mode ? (
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
  ) : null;
  // A class you never used is not shown; one you have sold out stays, for its history.
  if (rows.length === 0) return dialog;

  return (
    <>
      <CollapsiblePanel
        id="savings-plans"
        title="Savings plans"
        badge={`${totals.active} active`}
        figures={[
          { label: 'Value', value: moneyShort(totals.value) },
          { label: 'Still in', value: moneyShort(totals.cost) },
          {
            label: 'Gain (incl. redeemed)',
            value: signed(totals.gain),
            tone: tone(totals.gain),
          },
        ]}
        actions={
          canEdit && (
            <button
              type="button"
              className="secondary compact holdings-add"
              disabled={busy}
              onClick={() => setMode({ kind: 'plan' })}
            >
              <Plus size={15} />{' '}
              <span className="holdings-add__label">Add a savings plan</span>
            </button>
          )
        }
      >
        {error && <p className="notice error">{error}</p>}
        {rows.map(({ asset, v, due, portfolioName }) => (
          <article
            className="metal-asset"
            key={`${asset.id}-${portfolioName ?? ''}`}
          >
            <header className="metal-asset__head">
              <div>
                <b>{asset.name}</b>
                <small>
                  {asset.provider === 'pak-qatar-mbp'
                    ? `Pak-Qatar Family Takaful${PAK_QATAR_SUBFUNDS.find((f) => f.id === asset.subFund) ? ` · ${PAK_QATAR_SUBFUNDS.find((f) => f.id === asset.subFund)!.name}` : ''}`
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
            {asset.subFund &&
              !planNavs.some((n) => n.fundId === asset.subFund) && (
                <p className="notice error">
                  Unit prices for this sub-fund are not loaded
                  {planNavsError ? ` (${planNavsError})` : ''}, so the value is
                  not moved by the market yet.
                </p>
              )}
            <p className="report-source">
              {v.source === 'statement' &&
                `Value from your statement of ${dateText(v.statementDate!)}.`}
              {v.source === 'estimate' &&
                !v.statementDate &&
                'Estimated from what you paid in (less any load), moved by the sub-fund’s unit price since each payment. Enter your statement value to correct it.'}
              {v.source === 'estimate' &&
                v.statementDate &&
                `Estimated from your statement of ${dateText(v.statementDate!)}${planNavs.some((n) => n.fundId === asset.subFund) ? ' moved by the sub-fund’s unit price' : asset.assumedAnnualRate ? ` grown at ${(asset.assumedAnnualRate * 100).toFixed(1)}% a year` : ''} plus what you paid in and took out since. Enter the latest statement value to correct it.`}
              {v.source === 'paid-in' &&
                'No statement value yet, so the plan is shown at the amount paid in. Enter the value from your statement or app.'}
            </p>
            {canEdit &&
              asset.provider === 'pak-qatar-mbp' &&
              !asset.subFund && (
                <label className="notice">
                  <b>Which sub-fund is this plan in?</b>
                  <select
                    value=""
                    disabled={busy}
                    onChange={(e) =>
                      e.target.value &&
                      void update(
                        asset.id,
                        (p) => ({ ...p, subFund: e.target.value }),
                        'Sub-fund saved.',
                      )
                    }
                  >
                    <option value="">Choose…</option>
                    {PAK_QATAR_SUBFUNDS.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
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
                        ).then(() => track('plan_contribution_confirmed'))
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
                        ).then(() => track('plan_contribution_skipped'))
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
            <AssetHistory
              summary={`${asset.entries.length + asset.valuations.length} records`}
              rows={planHistoryRows(
                asset,
                canEdit,
                busy,
                update,
                (kind, editId) =>
                  setMode({ kind, planId: asset.id, editId }),
              )}
            />
          </article>
        ))}
      </CollapsiblePanel>
      {dialog}
    </>
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
  const editEntry =
    mode.kind !== 'plan' && mode.editId && mode.kind !== 'value'
      ? plan?.entries.find((e) => e.id === mode.editId)
      : undefined;
  const editValuation =
    mode.kind === 'value' && mode.editId
      ? plan?.valuations.find((x) => x.id === mode.editId)
      : undefined;
  const editing = !!(editEntry || editValuation);
  const [provider, setProvider] =
    useState<PlanAsset['provider']>('pak-qatar-mbp');
  const [name, setName] = useState(PAK_QATAR_PLAN_NAME);
  const [subFund, setSubFund] = useState<string>('pure-saving');
  const [date, setDate] = useState(
    editEntry?.date ?? editValuation?.date ?? today(),
  );
  const [amount, setAmount] = useState(
    editEntry ? String(editEntry.amount) : '',
  );
  const [loadPct, setLoadPct] = useState(
    editEntry?.load
      ? String(Math.round((editEntry.load / editEntry.amount) * 1e4) / 100)
      : '',
  );
  const [value, setValue] = useState(
    editValuation ? String(editValuation.value) : '',
  );
  const [rate, setRate] = useState('');
  const [day, setDay] = useState('5');
  const [from, setFrom] = useState(today().slice(0, 7));
  const [note, setNote] = useState(editEntry?.note ?? editValuation?.note ?? '');
  const [error, setError] = useState('');

  const titles = {
    plan: 'Add a savings plan',
    contribution: 'Pay in to the plan',
    redeem: 'Redeem cash from the plan',
    value: 'Update the plan value',
    monthly: 'Monthly contribution',
  } as const;
  const number = (text: string) => Number(text.replace(/,/g, ''));
  /** Front-end load in rupees for an amount paid, from the percentage typed (undefined when none). */
  const loadFor = (paid: number | null) => {
    const pct = loadPct.trim() === '' ? 0 : number(loadPct);
    if (!(pct >= 0 && pct < 100))
      throw new Error('Enter a load between 0 and 100 percent.');
    return pct > 0 && paid
      ? Math.round(((paid * pct) / 100) * 100) / 100
      : undefined;
  };

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
        const firstLoad = loadFor(first);
        if (first !== null && !(first > 0))
          throw new Error(
            'Enter the amount you first paid in, or leave it empty.',
          );
        const created: PlanAsset = {
          id: newPlanId(),
          kind: 'plan',
          name: name.trim(),
          provider,
          ...(provider === 'pak-qatar-mbp' ? { subFund } : {}),
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
                    ...(firstLoad === undefined ? {} : { load: firstLoad }),
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
          valuations: editValuation
            ? plan.valuations.map((x) =>
                x.id === editValuation.id
                  ? { ...x, date, value: v, note: note.trim() }
                  : x,
              )
            : [
                ...plan.valuations,
                { id: id(), date, value: v, note: note.trim() },
              ],
          closed:
            v === 0 && plan.entries.some((e) => e.type === 'redeem')
              ? true
              : plan.closed,
        };
        message = editing ? 'Entry updated.' : 'Plan value updated.';
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
        const record = {
          ...(editEntry ?? {}),
          id: editEntry?.id ?? id(),
          type: mode.kind,
          date,
          amount: a,
          load:
            mode.kind === 'contribution' && loadFor(a) !== undefined
              ? loadFor(a)
              : undefined,
          note: note.trim(),
        };
        next = {
          ...plan,
          entries: editEntry
            ? plan.entries.map((e) => (e.id === editEntry.id ? record : e))
            : [...plan.entries, record],
        };
        message = editEntry
          ? 'Entry updated.'
          : mode.kind === 'redeem'
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
      <DialogContent className="form-dialog tx-dialog asset-dialog">
        <DialogTitle>{editing ? 'Edit entry' : titles[mode.kind]}</DialogTitle>
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
                {provider === 'pak-qatar-mbp' && (
                  <label>
                    Sub-fund
                    <select
                      value={subFund}
                      onChange={(e) => setSubFund(e.target.value)}
                    >
                      {PAK_QATAR_SUBFUNDS.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
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
            {(mode.kind === 'contribution' || mode.kind === 'plan') && (
              <label>
                Front-end load (%), if charged
                <input
                  inputMode="decimal"
                  value={loadPct}
                  placeholder="e.g. 3"
                  onChange={(e) => setLoadPct(e.target.value)}
                />
                {number(loadPct) > 0 && number(amount) > 0 && (
                  <small>
                    Load{' '}
                    {money(
                      Math.round(
                        ((number(amount) * number(loadPct)) / 100) * 100,
                      ) / 100,
                    )}{' '}
                    taken out of what you paid, so{' '}
                    {money(
                      number(amount) -
                        Math.round(
                          ((number(amount) * number(loadPct)) / 100) * 100,
                        ) /
                          100,
                    )}{' '}
                    is invested.
                  </small>
                )}
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
