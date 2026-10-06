'use client';

import { useMemo, useState } from 'react';
import { Line, LineChart, XAxis, YAxis } from 'recharts';
import { Plus } from 'lucide-react';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  newFundId,
  valueFund,
  type FundAsset,
  type FundEntry,
} from '@/lib/funds';
import { dueEntries } from '@/lib/plans';
import type { FundCatalogResponse, FundNavRow } from '@/lib/mufap';
import { money, moneyShort, today } from '@/lib/portfolio';
import { useFundHistory } from './use-fund-data';
import AssetHistory, { type HistoryRow } from './asset-history';
import CollapsiblePanel from './collapsible-panel';

export type OwnedFund = { asset: FundAsset; portfolioName?: string };
type Catalog = FundCatalogResponse['funds'];
type Mode =
  | { kind: 'add' }
  | {
      kind: 'buy' | 'redeem' | 'dividend' | 'reinvest' | 'price' | 'monthly';
      fundId: string;
      prefill?: {
        date: string;
        amount: number;
        recurringId: string;
        month: string;
      };
    };

const tone = (n: number | null) =>
  n === null ? '' : n >= 0 ? 'pos-text' : 'neg-text';
const signed = (n: number) => `${n >= 0 ? '+' : '−'}${moneyShort(Math.abs(n))}`;
const units = (n: number) => `${Math.round(n * 10000) / 10000}`;
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
const rid = () =>
  `r-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
const TYPE_LABEL: Record<FundEntry['type'], string> = {
  opening: 'Opening balance',
  buy: 'Bought',
  redeem: 'Redeemed',
  dividend: 'Cash dividend',
  reinvest: 'Dividend reinvested',
};

/**
 * Mutual funds from any AMC reporting to MUFAP. Value is units times the price you would get on redemption, from MUFAP's
 * daily NAV (or a price you entered, if newer). Every purchase, redemption and dividend stays in the history.
 */
export default function MutualFundsSection({
  owned,
  catalog,
  navs,
  catalogError,
  canEdit,
  busy,
  addRequest = 0,
  onChange,
}: {
  owned: OwnedFund[];
  catalog: Catalog;
  navs: FundNavRow[];
  catalogError: string;
  canEdit: boolean;
  busy: boolean;
  /** Bumped by the page's + menu to open the add dialog. */
  addRequest?: number;
  onChange: (funds: FundAsset[], message: string) => Promise<void>;
}) {
  const asOf = today();
  const [mode, setMode] = useState<Mode | null>(null);
  const [error, setError] = useState('');
  const funds = owned.map((o) => o.asset);
  const rows = useMemo(
    () =>
      owned.map((o) => ({
        ...o,
        v: valueFund(o.asset, navs, asOf),
        due: dueEntries(o.asset, asOf),
      })),
    [owned, navs, asOf],
  );

  // Open the add dialog when the page's + menu asks for it (set during render, not in an effect).
  const [seenRequest, setSeenRequest] = useState(addRequest);
  if (addRequest !== seenRequest) {
    setSeenRequest(addRequest);
    if (addRequest > 0 && canEdit) setMode({ kind: 'add' });
  }
  const totals = useMemo(() => {
    const known = rows.every((r) => r.v.value !== null);
    return {
      value: known ? rows.reduce((a, r) => a + (r.v.value ?? 0), 0) : null,
      cost: rows.every((r) => r.v.cost !== null)
        ? rows.reduce((a, r) => a + (r.v.cost ?? 0), 0)
        : null,
      gain: rows.every((r) => r.v.gain !== null)
        ? rows.reduce((a, r) => a + (r.v.gain ?? 0), 0)
        : null,
      dividends: rows.reduce((a, r) => a + r.v.dividends, 0),
      held: rows.filter((r) => r.v.units > 0).length,
    };
  }, [rows]);

  async function update(
    fundId: string,
    change: (f: FundAsset) => FundAsset,
    message: string,
  ) {
    setError('');
    await onChange(
      funds.map((f) => (f.id === fundId ? change(f) : f)),
      message,
    ).catch((e: unknown) =>
      setError(e instanceof Error ? e.message : String(e)),
    );
  }

  const dialog = mode ? (
    <FundDialog
      mode={mode}
      funds={funds}
      catalog={catalog}
      navs={navs}
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
        id="mutual-funds"
        title="Mutual funds"
        badge={`${totals.held} held`}
        figures={[
          {
            label: 'Value',
            value:
              totals.value === null ? 'Price needed' : moneyShort(totals.value),
          },
          {
            label: 'Remaining cost',
            value:
              totals.cost === null ? 'Not yet known' : moneyShort(totals.cost),
          },
          {
            label: 'Gain / loss',
            value: totals.gain === null ? 'Not yet known' : signed(totals.gain),
            tone: tone(totals.gain),
          },
          { label: 'Dividends', value: moneyShort(totals.dividends) },
        ]}
        actions={
          canEdit && (
            <button
              type="button"
              className="secondary compact holdings-add"
              disabled={busy}
              onClick={() => setMode({ kind: 'add' })}
            >
              <Plus size={15} />{' '}
              <span className="holdings-add__label">Add a mutual fund</span>
            </button>
          )
        }
      >
        {catalogError && (
          <p className="notice">Could not load fund prices: {catalogError}</p>
        )}
        {error && <p className="notice error">{error}</p>}
        {rows.map(({ asset, v, due, portfolioName }) => (
          <article
            className="metal-asset"
            key={`${asset.id}-${portfolioName ?? ''}`}
          >
            <header className="metal-asset__head">
              <div>
                <b>{asset.fundName || asset.name}</b>
                <small>
                  {asset.amc} · {asset.category}
                  {portfolioName ? ` · ${portfolioName}` : ''}
                </small>
              </div>
              <div className="metal-asset__value amount">
                {v.value === null ? 'Price needed' : moneyShort(v.value)}
                <small className={tone(v.gain)}>
                  {v.gain === null
                    ? v.cost === null
                      ? 'cost not known'
                      : 'no price yet'
                    : signed(v.gain)}
                </small>
              </div>
            </header>
            <dl className="metal-asset__stats">
              <div>
                <dt>Units</dt>
                <dd>
                  {units(v.units)}
                  <small>{v.price ? `at ${v.price.nav.toFixed(4)}` : ''}</small>
                </dd>
              </div>
              <div>
                <dt>Average cost</dt>
                <dd>
                  {v.averageNav === null
                    ? '—'
                    : `${v.averageNav.toFixed(4)} / unit`}
                </dd>
              </div>
              <div>
                <dt>Realised / dividends</dt>
                <dd>
                  <span className={tone(v.realized)}>
                    {v.realized === null
                      ? 'cost not known'
                      : signed(v.realized)}
                  </span>
                  <small>{moneyShort(v.dividends)} in dividends</small>
                </dd>
              </div>
              <div>
                <dt>Bought / redeemed</dt>
                <dd>
                  {moneyShort(v.bought.amount)} /{' '}
                  {moneyShort(v.redeemed.amount)}
                </dd>
              </div>
            </dl>
            <p className="report-source">
              {v.price
                ? `Priced at ${v.price.nav.toFixed(4)} per unit (${v.price.source === 'mufap' ? 'MUFAP redemption price' : 'price you entered'}) · ${dateText(v.price.date)}${v.price.stale ? ' · STALE' : ''}`
                : 'No price available yet, so the value is not shown. You can enter one.'}
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
                        setMode({
                          kind: 'buy',
                          fundId: asset.id,
                          prefill: {
                            date: d.date,
                            amount: d.amount,
                            recurringId: d.ruleId,
                            month: d.month,
                          },
                        })
                      }
                    >
                      Record purchase
                    </button>
                    <button
                      type="button"
                      className="secondary compact"
                      disabled={busy}
                      onClick={() =>
                        void update(
                          asset.id,
                          (f) => ({
                            ...f,
                            rules: f.rules.map((r) =>
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
            {canEdit && (
              <div className="row">
                <button
                  type="button"
                  className="compact"
                  disabled={busy}
                  onClick={() => setMode({ kind: 'buy', fundId: asset.id })}
                >
                  Buy
                </button>
                <button
                  type="button"
                  className="secondary compact"
                  disabled={busy}
                  onClick={() => setMode({ kind: 'redeem', fundId: asset.id })}
                >
                  Redeem
                </button>
                <button
                  type="button"
                  className="secondary compact"
                  disabled={busy}
                  onClick={() =>
                    setMode({ kind: 'dividend', fundId: asset.id })
                  }
                >
                  Dividend
                </button>
                <button
                  type="button"
                  className="secondary compact"
                  disabled={busy}
                  onClick={() =>
                    setMode({ kind: 'reinvest', fundId: asset.id })
                  }
                >
                  Reinvested
                </button>
                <button
                  type="button"
                  className="secondary compact"
                  disabled={busy}
                  onClick={() => setMode({ kind: 'monthly', fundId: asset.id })}
                >
                  Monthly purchase
                </button>
                <button
                  type="button"
                  className="secondary compact"
                  disabled={busy}
                  onClick={() => setMode({ kind: 'price', fundId: asset.id })}
                >
                  Enter a price
                </button>
              </div>
            )}
            {asset.rules
              .filter((r) => !r.stopped)
              .map((r) => (
                <p key={r.id} className="report-source">
                  Monthly purchase: {money(r.amount)} on day {r.dayOfMonth} from{' '}
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
                            (f) => ({
                              ...f,
                              rules: f.rules.map((x) =>
                                x.id === r.id ? { ...x, stopped: true } : x,
                              ),
                            }),
                            'Monthly purchase stopped.',
                          )
                        }
                      >
                        Stop
                      </button>
                    </>
                  )}
                </p>
              ))}
            <FundHistory
              asset={asset}
              v={v}
              canEdit={canEdit}
              busy={busy}
              onToggle={(entryId) =>
                void update(
                  asset.id,
                  (f) => ({
                    ...f,
                    entries: f.entries.map((e) =>
                      e.id === entryId ? { ...e, voided: !e.voided } : e,
                    ),
                  }),
                  'Entry updated.',
                )
              }
            />
          </article>
        ))}
      </CollapsiblePanel>
      {dialog}
    </>
  );
}

function FundHistory({
  asset,
  v,
  canEdit,
  busy,
  onToggle,
}: {
  asset: FundAsset;
  v: ReturnType<typeof valueFund>;
  canEdit: boolean;
  busy: boolean;
  onToggle: (entryId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const history = useFundHistory(asset.mufapId, open);
  const data = history.navs.map((n) => ({
    date: n.date,
    nav: n.repurchase > 0 ? n.repurchase : n.nav,
  }));
  const rows: HistoryRow[] = [...asset.entries]
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .map((e) => {
      const h = v.history.find((x) => x.id === e.id);
      const inflow = e.type === 'redeem' || e.type === 'dividend';
      return {
        id: e.id,
        date: dateText(e.date),
        tag:
          e.type === 'redeem'
            ? 'sell'
            : e.type === 'dividend' || e.type === 'reinvest'
              ? 'income'
              : e.type === 'buy'
                ? 'buy'
                : 'neutral',
        tagLabel: TYPE_LABEL[e.type],
        title:
          e.units === undefined ? 'Cash payout' : `${units(e.units)} units`,
        note: e.taxWithheld
          ? `Tax withheld ${money(e.taxWithheld)}`
          : e.note || undefined,
        amount:
          e.amount === null
            ? 'Cost unknown'
            : e.type === 'reinvest'
              ? money(e.amount)
              : `${inflow ? '+' : '−'}${money(e.amount)}`,
        amountTone: inflow ? 'pos-text' : '',
        meta: [
          h ? `Holding ${units(h.heldAfter)} units` : '',
          h?.realizedGain != null ? `Gain ${signed(h.realizedGain)}` : '',
        ].filter(Boolean),
        voided: !!e.voided,
        action: canEdit
          ? {
              label: e.voided ? 'Restore' : 'Void',
              disabled: busy,
              onClick: () => onToggle(e.id),
            }
          : undefined,
      } satisfies HistoryRow;
    });
  return (
    <AssetHistory
      rows={rows}
      onOpenChange={setOpen}
      summary={`${v.history.length} ${v.history.length === 1 ? 'entry' : 'entries'} and price chart`}
    >
      {data.length > 1 ? (
        <ChartContainer
          config={{
            nav: { label: 'Redemption price', color: 'var(--primary)' },
          }}
          className="overview-income"
        >
          <LineChart
            data={data}
            margin={{ top: 8, right: 8, bottom: 0, left: 8 }}
          >
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              minTickGap={32}
              fontSize={11}
            />
            <YAxis
              domain={['auto', 'auto']}
              width={52}
              tickLine={false}
              axisLine={false}
              fontSize={11}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(value) => <b>{Number(value).toFixed(4)}</b>}
                />
              }
            />
            <Line
              dataKey="nav"
              type="monotone"
              stroke="var(--primary)"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ChartContainer>
      ) : (
        <p className="report-source">
          {history.error ||
            'The price chart builds up day by day from when this feature started; there is nothing older to show yet.'}
        </p>
      )}
    </AssetHistory>
  );
}

function FundDialog({
  mode,
  funds,
  catalog,
  navs,
  busy,
  onClose,
  onSave,
}: {
  mode: Mode;
  funds: FundAsset[];
  catalog: Catalog;
  navs: FundNavRow[];
  busy: boolean;
  onClose: () => void;
  onSave: (funds: FundAsset[], message: string) => Promise<void>;
}) {
  const fund =
    mode.kind === 'add' ? undefined : funds.find((f) => f.id === mode.fundId);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Catalog[number] | null>(null);
  const [type, setType] = useState<'buy' | 'opening'>('buy');
  const [date, setDate] = useState(
    mode.kind !== 'add' && mode.prefill ? mode.prefill.date : today(),
  );
  const [unitCount, setUnitCount] = useState('');
  const [amount, setAmount] = useState(
    mode.kind !== 'add' && mode.prefill ? String(mode.prefill.amount) : '',
  );
  const [tax, setTax] = useState('');
  const [price, setPrice] = useState('');
  const [day, setDay] = useState('1');
  const [from, setFrom] = useState(today().slice(0, 7));
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return catalog
      .filter((f) =>
        `${f.amc} ${f.fundName} ${f.category}`.toLowerCase().includes(q),
      )
      .slice(0, 40);
  }, [query, catalog]);
  const latest = (mufapId: string) => navs.find((n) => n.mufapId === mufapId);
  const number = (t: string) => Number(t.replace(/,/g, ''));
  const kind = mode.kind === 'add' ? type : mode.kind;
  const titles = {
    add: 'Add a mutual fund',
    buy: 'Buy units',
    redeem: 'Redeem units',
    dividend: 'Cash dividend received',
    reinvest: 'Dividend reinvested',
    price: 'Enter a price',
    monthly: 'Monthly purchase',
  } as const;

  async function submit(event: React.SyntheticEvent) {
    event.preventDefault();
    setError('');
    try {
      let target = fund;
      let list = funds;
      if (mode.kind === 'add') {
        if (!picked) throw new Error('Search and choose a fund.');
        if (funds.some((f) => f.mufapId === picked.mufapId))
          throw new Error(
            'You already track this fund. Add entries to it instead.',
          );
        target = {
          id: newFundId(),
          kind: 'fund',
          name: picked.fundName,
          mufapId: picked.mufapId,
          amc: picked.amc,
          fundName: picked.fundName,
          category: picked.category,
          note: '',
          entries: [],
          manualNavs: [],
          rules: [],
        };
        list = [...funds, target];
      }
      if (!target) throw new Error('That fund no longer exists.');
      let next: FundAsset = target;
      let message = 'Saved.';
      if (kind === 'price') {
        const p = number(price);
        if (!(p > 0)) throw new Error('Enter the price per unit.');
        next = {
          ...target,
          manualNavs: [...target.manualNavs, { id: rid(), date, nav: p }],
        };
        message = 'Price saved.';
      } else if (kind === 'monthly') {
        const a = number(amount);
        if (!(a > 0)) throw new Error('Enter the monthly amount.');
        next = {
          ...target,
          rules: [
            ...target.rules,
            {
              id: rid(),
              dayOfMonth: Math.floor(number(day)),
              amount: a,
              from,
              skipped: [],
            },
          ],
        };
        message = 'Monthly purchase set.';
      } else {
        const unknownCost = kind === 'opening' && amount.trim() === '';
        const a = unknownCost ? null : number(amount);
        if (!unknownCost && !(a! > 0 || (kind === 'reinvest' && a === 0)))
          throw new Error('Enter the amount.');
        const u = kind === 'dividend' ? undefined : number(unitCount);
        if (kind !== 'dividend' && !(u! > 0))
          throw new Error('Enter the number of units.');
        const t = tax.trim() === '' ? undefined : number(tax);
        const entry: FundEntry = {
          id: rid(),
          type: kind,
          date,
          ...(u === undefined ? {} : { units: u }),
          amount: a,
          ...(t === undefined ? {} : { taxWithheld: t }),
          ...(mode.kind === 'buy' && mode.prefill
            ? { recurringId: mode.prefill.recurringId }
            : {}),
          note: note.trim(),
        };
        next = { ...target, entries: [...target.entries, entry] };
        message =
          kind === 'redeem'
            ? 'Redemption recorded.'
            : kind === 'dividend'
              ? 'Dividend recorded.'
              : 'Purchase recorded.';
      }
      await onSave(
        list.map((f) => (f.id === next.id ? next : f)),
        message,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const showEntry =
    kind === 'buy' ||
    kind === 'opening' ||
    kind === 'redeem' ||
    kind === 'dividend' ||
    kind === 'reinvest';
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="form-dialog tx-dialog">
        <DialogTitle>{titles[mode.kind]}</DialogTitle>
        <DialogDescription>
          {fund
            ? fund.fundName
            : 'Fund names and prices are public; your amounts and units stay on your device.'}
        </DialogDescription>
        <form onSubmit={(e) => void submit(e)}>
          {mode.kind === 'add' && (
            <>
              <label>
                Search by fund or company
                <input
                  value={query}
                  placeholder="e.g. Meezan money market"
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setPicked(null);
                  }}
                />
              </label>
              {picked ? (
                <p className="muted">
                  <b>{picked.fundName}</b> · {picked.amc} · {picked.category}
                  {latest(picked.mufapId)
                    ? ` · latest price ${latest(picked.mufapId)!.repurchase.toFixed(4)} (${dateText(latest(picked.mufapId)!.date)})`
                    : ''}
                </p>
              ) : (
                <ul className="ticker-options" style={{ position: 'static' }}>
                  {matches.map((f) => (
                    <li key={f.mufapId}>
                      <button type="button" onClick={() => setPicked(f)}>
                        <b>{f.fundName}</b>
                        <span>
                          {f.amc} · {f.category}
                        </span>
                      </button>
                    </li>
                  ))}
                  {query.trim().length >= 2 && matches.length === 0 && (
                    <li className="muted">
                      {catalog.length
                        ? 'No fund matches that.'
                        : 'The fund list has not loaded yet.'}
                    </li>
                  )}
                </ul>
              )}
              <fieldset className="tx-types">
                <legend className="sr-only">First entry</legend>
                {(['buy', 'opening'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={type === t}
                    className={type === t ? 'compact' : 'secondary compact'}
                    onClick={() => setType(t)}
                  >
                    {t === 'buy' ? 'I bought units' : 'Already owned'}
                  </button>
                ))}
              </fieldset>
            </>
          )}
          <div className="form-grid">
            {kind !== 'monthly' && (
              <label>
                Date
                <input
                  type="date"
                  value={date}
                  max={today()}
                  onChange={(e) => setDate(e.target.value)}
                  required
                />
              </label>
            )}
            {showEntry && kind !== 'dividend' && (
              <label>
                Units
                <input
                  inputMode="decimal"
                  value={unitCount}
                  onChange={(e) => setUnitCount(e.target.value)}
                />
              </label>
            )}
            {showEntry && (
              <label>
                {kind === 'redeem'
                  ? 'Cash received after load and tax (Rs)'
                  : kind === 'dividend'
                    ? 'Dividend received (Rs)'
                    : kind === 'reinvest'
                      ? 'Amount reinvested (Rs)'
                      : kind === 'opening'
                        ? 'What it cost you (Rs), empty if unknown'
                        : 'Amount paid (Rs), load included'}
                <input
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>
            )}
            {(kind === 'redeem' || kind === 'dividend') && (
              <label>
                Tax withheld (Rs), if shown
                <input
                  inputMode="decimal"
                  value={tax}
                  onChange={(e) => setTax(e.target.value)}
                />
              </label>
            )}
            {kind === 'price' && (
              <label>
                Price per unit (Rs)
                <input
                  inputMode="decimal"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                />
              </label>
            )}
            {kind === 'monthly' && (
              <>
                <label>
                  Monthly amount (Rs)
                  <input
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </label>
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
            {kind !== 'monthly' && (
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
