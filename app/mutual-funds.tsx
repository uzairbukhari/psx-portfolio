'use client';

import { ownedKey } from './asset-keys';
import { useEffect, useMemo, useState } from 'react';
import { EChart } from './charts/echart';
import { timeSeriesOption } from '@/lib/chart-kit';
import { ArrowLeft, MoreHorizontal, Plus } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import {
  latestNavs,
  redemptionPrice,
  type FundCatalogResponse,
  type FundNavRow,
} from '@/lib/mufap';
import { money, moneyShort, today } from '@/lib/portfolio';
import FundMatchDialog from './fund-match-dialog';
import { useFundHistory } from './use-fund-data';
import { webPublicData } from './vault-transport';
import CollapsiblePanel from './collapsible-panel';
import LedgerTimeline from './ledger-timeline';
import { NO_STOCKS, buildAssetEntries } from '@/lib/ledger-entries';

export type OwnedFund = { asset: FundAsset; portfolioName?: string };
/** Identifies one fund on its own page (the same fund can sit in several portfolios on the All view). */
type Catalog = FundCatalogResponse['funds'];
type Mode =
  | { kind: 'add' }
  | { kind: 'match'; fundId: string }
  | {
      kind:
        | 'buy'
        | 'opening'
        | 'redeem'
        | 'dividend'
        | 'reinvest'
        | 'price'
        | 'monthly';
      fundId: string;
      /** The history entry being corrected, when editing rather than adding. */
      editId?: string;
      prefill?: {
        date: string;
        amount: number;
        recurringId: string;
        month: string;
      };
    };

const ENTRY_HISTORY_LENGTH =
  typeof window === 'undefined' ? 0 : window.history.length;
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

/**
 * Mutual funds from any AMC reporting to MUFAP. Value is units times the price you would get on redemption, from MUFAP's
 * daily NAV (or a price you entered, if newer). Every purchase, redemption and dividend stays in the history.
 */
export default function MutualFundsSection({
  owned,
  catalog,
  navs,
  catalogError,
  onRetryPrice,
  retrying = false,
  canEdit,
  busy,
  addRequest = 0,
  focusKey,
  onOpenFund,
  onBack,
  onSwitchPortfolio,
  onChange,
}: {
  owned: OwnedFund[];
  catalog: Catalog;
  navs: FundNavRow[];
  catalogError: string;
  /** Fetches the fund prices again; shown as a button wherever a price is still needed. */
  onRetryPrice?: () => Promise<void>;
  retrying?: boolean;
  canEdit: boolean;
  busy: boolean;
  /** Bumped by the page's + menu to open the add dialog. */
  addRequest?: number;
  /** Shows that one fund's page instead of the provider tables. */
  focusKey?: string;
  onOpenFund?: (key: string) => void;
  onBack?: () => void;
  /** On the All view a fund can only be edited inside its own portfolio; this switches to it. */
  onSwitchPortfolio?: (key: string) => void;
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
  const priceButton = (
    <button
      type="button"
      className="secondary compact"
      disabled={retrying || !onRetryPrice}
      title="Try to fetch the price again"
      onClick={() => void onRetryPrice?.()}
    >
      {retrying ? 'Fetching…' : 'Price needed'}
    </button>
  );
  const groups = useMemo(() => {
    const by = new Map<string, typeof rows>();
    for (const r of rows) {
      const amc = r.asset.amc || 'Other providers';
      by.set(amc, [...(by.get(amc) ?? []), r]);
    }
    // A fund with no price yet is left out of value and gain until its price is known.
    return [...by]
      .map(([amc, all]) => {
        const list = all.filter((r) => r.v.value !== null);
        return {
          amc,
          rows: all,
          value: list.reduce((a, r) => a + (r.v.value ?? 0), 0),
          gain: list.every((r) => r.v.gain !== null)
            ? list.reduce((a, r) => a + (r.v.gain ?? 0), 0)
            : null,
        };
      })
      .sort((a, b) => a.amc.localeCompare(b.amc));
  }, [rows]);
  const totals = useMemo(() => {
    // Funds still waiting for a price are ignored here (value, cost and gain) until it is known.
    const priced = rows.filter((r) => r.v.value !== null);
    return {
      value: priced.reduce((a, r) => a + (r.v.value ?? 0), 0),
      cost: priced.every((r) => r.v.cost !== null)
        ? priced.reduce((a, r) => a + (r.v.cost ?? 0), 0)
        : null,
      gain: priced.every((r) => r.v.gain !== null)
        ? priced.reduce((a, r) => a + (r.v.gain ?? 0), 0)
        : null,
      dividends: rows.reduce((a, r) => a + r.v.income, 0),
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

  const matchTarget =
    mode?.kind === 'match'
      ? funds.find((f) => f.id === mode.fundId)
      : undefined;
  const dialog = matchTarget ? (
    <FundMatchDialog
      fund={matchTarget}
      navs={navs}
      busy={busy}
      onClose={() => setMode(null)}
      onSave={async (next, message) => {
        await onChange(
          funds.map((f) => (f.id === next.id ? next : f)),
          message,
        );
        setMode(null);
      }}
    />
  ) : mode && mode.kind !== 'match' ? (
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
  if (focusKey !== undefined) {
    const row = rows.find((r) => ownedKey(r) === focusKey);
    const back = (
      <button
        type="button"
        data-slot="link"
        className="back-link company-back"
        onClick={() => {
          if (window.history.length > ENTRY_HISTORY_LENGTH)
            window.history.back();
          else onBack?.();
        }}
      >
        <ArrowLeft size={15} /> Back
      </button>
    );
    if (!row)
      return (
        <div className="company-page">
          {back}
          <p className="muted">This fund is not in your portfolio.</p>
          {dialog}
        </div>
      );
    const { asset, v, due } = row;
    return (
      <div className="company-page">
        {back}
        <div className="company-head">
          <div>
            <p className="eyebrow">{asset.category.toUpperCase()}</p>
            <h1>{asset.fundName || asset.name}</h1>
            <p>
              {asset.amc}
              {row.portfolioName ? ` · ${row.portfolioName}` : ''}
            </p>
          </div>
          <div className="company-price">
            <strong>{v.price ? v.price.nav.toFixed(4) : '—'}</strong>
            <small>
              {v.price
                ? `${v.price.source === 'mufap' ? 'Redemption price' : 'Price you entered'} · ${dateText(v.price.date)}${v.price.stale ? ' · STALE' : ''}`
                : 'No price yet'}
            </small>
          </div>
          {!canEdit && row.portfolioName && onSwitchPortfolio && (
            <div className="company-actions">
              <button onClick={() => onSwitchPortfolio(focusKey)}>
                Open in {row.portfolioName} to record transactions
              </button>
            </div>
          )}
          {canEdit && (
            <div className="company-actions">
              <button
                disabled={busy}
                onClick={() => setMode({ kind: 'buy', fundId: asset.id })}
              >
                <Plus size={16} /> Buy
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger
                  className="secondary company-more"
                  aria-label="More actions"
                >
                  <MoreHorizontal size={18} />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {(
                    [
                      ['redeem', 'Redeem'],
                      ['dividend', 'Dividend'],
                      ['reinvest', 'Dividend reinvested'],
                      ['monthly', 'Monthly purchase'],
                      ['price', 'Enter a price'],
                    ] as const
                  ).map(([kind, label]) => (
                    <DropdownMenuItem
                      key={kind}
                      disabled={busy}
                      onClick={() => setMode({ kind, fundId: asset.id })}
                    >
                      {label}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuItem
                    disabled={busy}
                    onClick={() => setMode({ kind: 'match', fundId: asset.id })}
                  >
                    Match my statement
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
        {catalogError && (
          <p className="notice">Could not load fund prices: {catalogError}</p>
        )}
        {error && <p className="notice error">{error}</p>}
        <div className="company-cards">
          <article>
            <span>Units held</span>
            <strong>{units(v.units)}</strong>
            <small>
              Avg. cost{' '}
              {v.averageNav === null
                ? '—'
                : `${v.averageNav.toFixed(4)} / unit`}
            </small>
          </article>
          <article>
            <span>Market value</span>
            <strong>{v.value === null ? priceButton : money(v.value)}</strong>
            <small>Cost {v.cost === null ? '—' : money(v.cost)}</small>
          </article>
          <article>
            <span>Gain / loss</span>
            <strong className={tone(v.gain)}>
              {v.gain === null ? '—' : signed(v.gain)}
            </strong>
            <small>
              {v.gain === null
                ? v.cost === null
                  ? 'Cost not known'
                  : 'Needs a price'
                : 'Unrealised'}
            </small>
          </article>
          <article>
            <span>Realised / dividends</span>
            <strong className={tone(v.realized)}>
              {v.realized === null ? '—' : signed(v.realized)}
            </strong>
            <small>
              {moneyShort(v.income)} in dividends
              {v.reinvested > 0
                ? ` (${moneyShort(v.reinvested)} reinvested)`
                : ''}{' '}
              · bought {moneyShort(v.bought.amount)} · redeemed{' '}
              {moneyShort(v.redeemed.amount)}
            </small>
          </article>
        </div>
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
                            ? {
                                ...r,
                                skipped: [...r.skipped, d.month],
                              }
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
        <FundHistory asset={asset} v={v} />
        <section className="company-section">
          <h2>Activity</h2>
          <LedgerTimeline
            portfolio={NO_STOCKS}
            ticker={asset.fundName || asset.name}
            hideKpis
            entries={buildAssetEntries([{ asset }], () => undefined, {
              correct: (_a, entryId) => {
                const entry = asset.entries.find((e) => e.id === entryId);
                if (entry)
                  setMode({
                    kind: entry.type,
                    fundId: asset.id,
                    editId: entryId,
                  });
              },
              toggleVoid: (_a, entryId) =>
                void update(
                  asset.id,
                  (f) => ({
                    ...f,
                    entries: f.entries.map((e) =>
                      e.id === entryId ? { ...e, voided: !e.voided } : e,
                    ),
                  }),
                  'Entry updated.',
                ),
            })}
          />
        </section>

        {dialog}
      </div>
    );
  }
  // A class you never used is not shown; one you have sold out stays, for its history.
  if (rows.length === 0) return dialog;

  return (
    <>
      <CollapsiblePanel
        flat
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
        {groups.map((g) => (
          <section className="fund-group" key={g.amc}>
            <header className="fund-group__head">
              <div>
                <b>{g.amc}</b>
                <small>
                  {g.rows.length} {g.rows.length === 1 ? 'fund' : 'funds'}
                </small>
              </div>
              <div className="fund-group__totals amount">
                {g.value === null ? 'Price needed' : moneyShort(g.value)}
                <small className={tone(g.gain)}>
                  {g.gain === null ? 'gain not known' : signed(g.gain)}
                </small>
              </div>
            </header>
            <div className="fund-table-wrap">
              <table className="fund-table">
                <thead>
                  <tr>
                    <th>Fund</th>
                    <th>Units</th>
                    <th>Avg cost</th>
                    <th>Price</th>
                    <th>Value</th>
                    <th>Gain / loss</th>
                    <th>Realised / dividends</th>
                  </tr>
                </thead>
                {g.rows.map(({ asset, v, portfolioName }) => {
                  const key = ownedKey({ asset, portfolioName });
                  return (
                    <tbody key={key}>
                      <tr className="fund-row">
                        <td data-label="Fund" className="fund-row__name">
                          <button
                            type="button"
                            className="fund-row__toggle"
                            onClick={() => onOpenFund?.(key)}
                          >
                            <span>
                              <b>{asset.fundName || asset.name}</b>
                              <small>
                                {asset.category}
                                {portfolioName ? ` · ${portfolioName}` : ''}
                              </small>
                            </span>
                          </button>
                        </td>
                        <td data-label="Units">{units(v.units)}</td>
                        <td data-label="Avg cost">
                          {v.averageNav === null
                            ? '—'
                            : v.averageNav.toFixed(4)}
                        </td>
                        <td data-label="Price">
                          {v.price ? (
                            <>
                              {v.price.nav.toFixed(4)}
                              <small>
                                {v.price.source === 'mufap' ? '' : 'entered · '}
                                {dateText(v.price.date)}
                                {v.price.stale ? ' · STALE' : ''}
                              </small>
                            </>
                          ) : (
                            <small>No price yet</small>
                          )}
                        </td>
                        <td data-label="Value" className="amount">
                          {v.value === null ? priceButton : moneyShort(v.value)}
                        </td>
                        <td data-label="Gain / loss" className={tone(v.gain)}>
                          {v.gain === null
                            ? v.cost === null
                              ? 'cost not known'
                              : 'no price yet'
                            : signed(v.gain)}
                        </td>
                        <td data-label="Realised / dividends">
                          <span className={tone(v.realized)}>
                            {v.realized === null
                              ? 'cost not known'
                              : signed(v.realized)}
                          </span>
                          <small>{moneyShort(v.income)} in dividends</small>
                        </td>
                      </tr>
                    </tbody>
                  );
                })}
              </table>
            </div>
          </section>
        ))}
      </CollapsiblePanel>
      {dialog}
    </>
  );
}

/** The fund page's price chart: MUFAP prices plus what you paid per unit, so it has a line while daily history is short. */
function FundHistory({
  asset,
  v,
}: {
  asset: FundAsset;
  v: ReturnType<typeof valueFund>;
}) {
  const history = useFundHistory(asset.mufapId, true);
  // MUFAP's stored prices, plus what you paid per unit and the latest price, so the chart has a line
  // even while the daily history is still short.
  const byDate = new Map<string, number>();
  for (const e of asset.entries)
    if (!e.voided && e.units && e.amount && e.type !== 'redeem')
      byDate.set(e.date, e.amount / e.units);
  for (const n of history.navs) {
    const price = n.repurchase > 0 ? n.repurchase : n.nav;
    if (price > 0) byDate.set(n.date, price);
  }
  if (v.price) byDate.set(v.price.date, v.price.nav);
  const data = [...byDate]
    .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))
    .map(([date, nav]) => ({ date, nav }));
  const sparse = history.navs.length < 2;
  return (
    <>
      <section className="panel">
        <div className="company-chart-head">
          <div>
            <h3>Price per unit</h3>
            <small className="muted">
              {sparse
                ? 'Built from your purchase prices and the latest MUFAP price. MUFAP history fills in daily.'
                : 'MUFAP redemption price'}
            </small>
          </div>
        </div>
        {data.length > 1 ? (
          <EChart
            className="company-chart"
            label={`Fund price per unit, ${data.length} prices. Latest ${data[data.length - 1].nav.toFixed(2)}.`}
            build={(t) =>
              timeSeriesOption(t, {
                name: 'Price per unit',
                data: data.map((d) => ({ x: d.date, y: d.nav })),
                area: true,
                categorical: data.length < 12,
                valueFormat: (n) => n.toFixed(4),
                axisFormat: (n) => n.toFixed(2),
                dateLabel: (x) => dateText(String(x)),
              })
            }
          />
        ) : (
          <p className="muted">
            {history.error ||
              'There is no price history for this fund yet. It builds up day by day.'}
          </p>
        )}
      </section>
    </>
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
  mode: Exclude<Mode, { kind: 'match' }>;
  funds: FundAsset[];
  catalog: Catalog;
  navs: FundNavRow[];
  busy: boolean;
  onClose: () => void;
  onSave: (funds: FundAsset[], message: string) => Promise<void>;
}) {
  const fund =
    mode.kind === 'add' ? undefined : funds.find((f) => f.id === mode.fundId);
  const editEntry =
    mode.kind !== 'add' && mode.editId
      ? fund?.entries.find((e) => e.id === mode.editId)
      : undefined;
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Catalog[number] | null>(null);
  const [type, setType] = useState<'buy' | 'opening'>('buy');
  const [date, setDate] = useState(
    editEntry?.date ??
      (mode.kind !== 'add' && mode.prefill ? mode.prefill.date : today()),
  );
  const [unitCount, setUnitCount] = useState(
    editEntry?.units !== undefined
      ? String(editEntry.units)
      : mode.kind !== 'add' && mode.prefill
        ? ''
        : '1',
  );
  const [amount, setAmount] = useState(
    editEntry?.amount != null
      ? String(editEntry.amount)
      : mode.kind !== 'add' && mode.prefill
        ? String(mode.prefill.amount)
        : '',
  );
  const [tax, setTax] = useState(
    editEntry?.taxWithheld !== undefined ? String(editEntry.taxWithheld) : '',
  );
  const [loadPct, setLoadPct] = useState(
    editEntry?.load && editEntry.amount
      ? String(Math.round((editEntry.load / editEntry.amount) * 1e4) / 100)
      : editEntry
        ? ''
        : '0',
  );
  const [price, setPrice] = useState('');
  const [day, setDay] = useState('1');
  const [from, setFrom] = useState(today().slice(0, 7));
  const [note, setNote] = useState(editEntry?.note ?? '');
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
  // A new purchase is filled in from the fund's price on the chosen date (units times the price you would pay).
  const mufapId = fund?.mufapId ?? picked?.mufapId;
  const autofill =
    kind === 'buy' && !editEntry && !(mode.kind !== 'add' && mode.prefill);
  const [history, setHistory] = useState<{
    id: string;
    navs: FundNavRow[];
  } | null>(null);
  useEffect(() => {
    if (!autofill || !mufapId || history?.id === mufapId) return;
    let live = true;
    const done = (rows: FundNavRow[]) =>
      live && setHistory({ id: mufapId, navs: rows });
    (webPublicData.fundHistory?.(mufapId) ?? Promise.reject())
      .then((r) => done(r.navs))
      .catch(() => done([]));
    return () => {
      live = false;
    };
  }, [autofill, mufapId, history?.id]);
  const unitPrice = useMemo(() => {
    if (!autofill || !mufapId) return null;
    const rows = [
      ...(history?.id === mufapId ? history.navs : []),
      ...navs.filter((n) => n.mufapId === mufapId),
    ];
    const row = latestNavs(rows, date).get(mufapId);
    if (!row) return null;
    return row.offer > 0 ? row.offer : redemptionPrice(row);
  }, [autofill, mufapId, history, navs, date]);
  const suggested = (() => {
    const u = Number(unitCount.replace(/,/g, ''));
    return unitPrice !== null && u > 0
      ? String(Math.round(u * unitPrice * 100) / 100)
      : null;
  })();
  const [seenSuggested, setSeenSuggested] = useState<string | null>(null);
  if (suggested !== seenSuggested) {
    setSeenSuggested(suggested);
    if (suggested !== null) setAmount(suggested);
  }
  const titles = {
    add: 'Add a mutual fund',
    buy: 'Buy units',
    redeem: 'Redeem units',
    dividend: 'Cash dividend received',
    reinvest: 'Dividend reinvested',
    opening: 'Opening balance',
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
        const pct =
          kind === 'buy' && loadPct.trim() !== '' ? number(loadPct) : 0;
        if (!(pct >= 0 && pct < 100))
          throw new Error('Enter a load between 0 and 100 percent.');
        const load =
          pct > 0 && a ? Math.round(((a * pct) / 100) * 100) / 100 : undefined;
        const entry: FundEntry = {
          ...(editEntry ?? {}),
          id: editEntry?.id ?? rid(),
          type: kind,
          date,
          units: u,
          amount: a,
          taxWithheld: t,
          load,
          ...(mode.kind === 'buy' && mode.prefill
            ? { recurringId: mode.prefill.recurringId }
            : {}),
          note: note.trim(),
        };
        next = {
          ...target,
          entries: editEntry
            ? target.entries.map((e) => (e.id === editEntry.id ? entry : e))
            : [...target.entries, entry],
        };
        message = editEntry
          ? 'Entry updated.'
          : kind === 'redeem'
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
      <DialogContent className="form-dialog tx-dialog asset-dialog">
        <DialogTitle>
          {editEntry ? 'Edit entry' : titles[mode.kind]}
        </DialogTitle>
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
                      <button
                        type="button"
                        onClick={() => {
                          setPicked(f);
                          setQuery(f.fundName);
                        }}
                      >
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
            {kind === 'buy' && (
              <label>
                Front-end load (%), if charged
                <input
                  inputMode="decimal"
                  value={loadPct}
                  placeholder="e.g. 1.5"
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
