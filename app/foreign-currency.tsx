'use client';

import { useMemo, useState } from 'react';
import { ArrowLeft, Plus } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { newAssetId } from '@/lib/assets';
import {
  currencyPosition,
  valueCurrency,
  type CurrencyAsset,
  type CurrencyEntry,
} from '@/lib/currency';
import {
  CURRENCY_NAMES,
  SUPPORTED_CURRENCIES,
  chooseFxRate,
  type CurrencyCode,
  type FxRatesResponse,
} from '@/lib/fx-rates';
import { timeSeriesOption } from '@/lib/chart-kit';
import { money, moneyShort, today } from '@/lib/portfolio';
import { ownedKey } from './asset-keys';
import { EChart } from './charts/echart';
import CollapsiblePanel from './collapsible-panel';
import LedgerTimeline from './ledger-timeline';
import { NO_STOCKS, buildAssetEntries } from '@/lib/ledger-entries';

export type OwnedCurrency = {
  asset: CurrencyAsset;
  portfolioId?: string;
  portfolioName?: string;
};
const tone = (n: number | null) =>
  n === null ? '' : n >= 0 ? 'pos-text' : 'neg-text';
const signed = (n: number) => `${n >= 0 ? '+' : '−'}${moneyShort(Math.abs(n))}`;
const units = (n: number) => String(Math.round(n * 1e4) / 1e4);
const NEW = '';
const ENTRY_HISTORY_LENGTH =
  typeof window === 'undefined' ? 0 : window.history.length;
const dateText = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

/**
 * Foreign currency (US dollar, UAE dirham, Saudi riyal) kept as cash or in a foreign currency account, tracked in
 * rupees. Values come from public rates and are calculated here, on the device. In the All view it is read-only.
 */
export default function ForeignCurrencySection({
  owned,
  fx,
  fxError,
  canEdit,
  busy,
  addRequest = 0,
  focusKey,
  onOpenAsset,
  onBack,
  onSwitchPortfolio,
  onChange,
}: {
  owned: OwnedCurrency[];
  fx: FxRatesResponse;
  fxError: string;
  canEdit: boolean;
  busy: boolean;
  /** Bumped by the page's + menu to open the add dialog. */
  addRequest?: number;
  /** Shows that one holding's page instead of the table. */
  focusKey?: string;
  onOpenAsset?: (key: string) => void;
  onBack?: () => void;
  /** On the All view a holding can only be edited inside its own portfolio; this switches to it. */
  onSwitchPortfolio?: (key: string) => void;
  /** Receives this portfolio's complete currency list after an add, sale or void. */
  onChange: (assets: CurrencyAsset[], message: string) => Promise<void>;
}) {
  const asOf = today();
  const [open, setOpen] = useState<{
    type: CurrencyEntry['type'];
    assetId?: string;
    entryId?: string;
  } | null>(null);
  const [error, setError] = useState('');
  const rows = useMemo(
    () =>
      owned.map((o) => ({ ...o, v: valueCurrency(o.asset, fx.rates, asOf) })),
    [owned, fx.rates, asOf],
  );
  const assets = owned.map((o) => o.asset);
  const [seenRequest, setSeenRequest] = useState(addRequest);
  if (addRequest !== seenRequest) {
    setSeenRequest(addRequest);
    if (addRequest > 0 && canEdit) setOpen({ type: 'buy' });
  }
  const totals = useMemo(
    () => ({
      value: rows.every((r) => r.v.value !== null)
        ? rows.reduce((a, r) => a + (r.v.value ?? 0), 0)
        : null,
      cost: rows.every((r) => r.v.cost !== null)
        ? rows.reduce((a, r) => a + (r.v.cost ?? 0), 0)
        : null,
      gain: rows.every((r) => r.v.gain !== null)
        ? rows.reduce((a, r) => a + (r.v.gain ?? 0), 0)
        : null,
      held: rows.filter((r) => r.v.units > 0).length,
    }),
    [rows],
  );

  async function toggleVoid(assetId: string, entryId: string) {
    const next = assets.map((a) =>
      a.id === assetId
        ? {
            ...a,
            entries: a.entries.map((e) =>
              e.id === entryId ? { ...e, voided: !e.voided } : e,
            ),
          }
        : a,
    );
    await onChange(next, 'Entry updated.').catch((e: unknown) =>
      setError(e instanceof Error ? e.message : String(e)),
    );
  }

  const dialog = open ? (
    <CurrencyEntryDialog
      initialType={open.type}
      presetAssetId={open.assetId && !open.entryId ? open.assetId : undefined}
      editing={
        open.assetId && open.entryId
          ? {
              assetId: open.assetId,
              entry: assets
                .find((a) => a.id === open.assetId)
                ?.entries.find((e) => e.id === open.entryId),
            }
          : undefined
      }
      assets={assets}
      fx={fx}
      busy={busy}
      onClose={() => setOpen(null)}
      onSave={async (next, message) => {
        await onChange(next, message);
        setOpen(null);
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
          <p className="muted">This holding is not in your portfolio.</p>
          {dialog}
        </div>
      );
    const { asset, v } = row;
    return (
      <div className="company-page">
        {back}
        <div className="company-head">
          <div>
            <p className="eyebrow">
              {asset.currency}
              {asset.heldAt === 'bank'
                ? ' · BANK ACCOUNT'
                : asset.heldAt === 'cash'
                  ? ' · CASH'
                  : ''}
            </p>
            <h1>{asset.name}</h1>
            <p>{row.portfolioName ?? CURRENCY_NAMES[asset.currency]}</p>
          </div>
          <div className="company-price">
            <strong>{v.rate ? money(v.rate.pkrPerUnit) : '—'}</strong>
            <small>
              {v.rate
                ? `per ${asset.currency} · ${dateText(v.rate.date)}`
                : 'No rate yet'}
            </small>
          </div>
          {canEdit && (
            <div className="company-actions">
              <button
                disabled={busy}
                onClick={() => setOpen({ type: 'buy', assetId: asset.id })}
              >
                <Plus size={16} /> Add purchase
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => setOpen({ type: 'sell', assetId: asset.id })}
              >
                Record a sale
              </button>
            </div>
          )}
          {!canEdit && row.portfolioName && onSwitchPortfolio && (
            <div className="company-actions">
              <button onClick={() => onSwitchPortfolio(focusKey)}>
                Open in {row.portfolioName} to record transactions
              </button>
            </div>
          )}
        </div>
        {fxError && (
          <p className="notice">Could not load today&apos;s rates: {fxError}</p>
        )}
        {error && <p className="notice error">{error}</p>}
        <div className="company-cards">
          <article>
            <span>Held</span>
            <strong>
              {units(v.units)} {asset.currency}
            </strong>
            <small>
              Average cost {v.averageRate === null ? '—' : money(v.averageRate)}
            </small>
          </article>
          <article>
            <span>Market value</span>
            <strong>{v.value === null ? '—' : money(v.value)}</strong>
            <small>Cost {v.cost === null ? '—' : money(v.cost)}</small>
          </article>
          <article>
            <span>Gain / loss</span>
            <strong className={tone(v.gain)}>
              {v.gain === null ? '—' : signed(v.gain)}
            </strong>
            <small className={tone(v.gainPercent)}>
              {v.gainPercent === null
                ? 'Needs cost and rate'
                : `${v.gainPercent >= 0 ? '+' : '−'}${Math.abs(v.gainPercent).toFixed(1)}%`}
            </small>
          </article>
          <article>
            <span>Realised gain</span>
            <strong className={tone(v.realized)}>
              {v.realized === null ? '—' : signed(v.realized)}
            </strong>
            <small>
              Bought {moneyShort(v.bought.pkr)} · sold {moneyShort(v.sold.pkr)}
            </small>
          </article>
        </div>
        <p className="report-source">
          {v.rate
            ? `Priced at ${money(v.rate.pkrPerUnit)} per ${asset.currency} · ${v.rate.kind === 'open_market' ? 'open-market buying rate' : 'interbank estimate'}${v.rate.fellBack ? ' (the open-market rate is more than 2 days old)' : ''}${v.rate.stale ? ' · STALE' : ''}`
            : 'No rate available yet, so the value is not shown.'}
        </p>
        <section className="company-section">
          <h2>Rate and your trades</h2>
          <RateChart fx={fx} asset={asset} />
        </section>
        <section className="company-section">
          <h2>Held over time</h2>
          <HeldChart asset={asset} />
        </section>
        <section className="company-section">
          <h2>Activity</h2>
          <LedgerTimeline
            portfolio={NO_STOCKS}
            ticker={asset.name}
            hideKpis
            entries={buildAssetEntries(
              [{ asset }],
              () => undefined,
              canEdit
                ? {
                    correct: (_a, entryId) =>
                      setOpen({ type: 'buy', assetId: asset.id, entryId }),
                    toggleVoid: (_a, entryId) =>
                      void toggleVoid(asset.id, entryId),
                  }
                : undefined,
            )}
          />
        </section>
        {dialog}
      </div>
    );
  }
  // A currency you never used is not shown; one you have sold out stays, for its history.
  if (rows.length === 0) return dialog;

  return (
    <>
      <CollapsiblePanel
        id="foreign-currency"
        title="Foreign currency"
        badge={`${totals.held} held`}
        figures={[
          {
            label: 'Value',
            value:
              totals.value === null ? 'Rate needed' : moneyShort(totals.value),
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
        ]}
        actions={
          canEdit && (
            <>
              <button
                type="button"
                className="secondary compact"
                disabled={busy}
                onClick={() => setOpen({ type: 'sell' })}
              >
                Record a sale
              </button>
              <button
                type="button"
                className="secondary compact holdings-add"
                disabled={busy}
                onClick={() => setOpen({ type: 'buy' })}
              >
                <Plus size={15} />{' '}
                <span className="holdings-add__label">Add currency</span>
              </button>
            </>
          )
        }
      >
        {fxError && (
          <p className="notice">Could not load today&apos;s rates: {fxError}</p>
        )}
        {error && <p className="notice error">{error}</p>}
        <div className="fund-table-wrap">
          <table className="fund-table">
            <thead>
              <tr>
                <th>Holding</th>
                <th>Held</th>
                <th>Avg cost</th>
                <th>Rate</th>
                <th>Value</th>
                <th>Gain / loss</th>
                <th>Realised</th>
              </tr>
            </thead>
            {rows.map((row) => (
              <tbody key={ownedKey(row)}>
                <tr className="fund-row">
                  <td data-label="Holding" className="fund-row__name">
                    <button
                      type="button"
                      className="fund-row__toggle"
                      onClick={() => onOpenAsset?.(ownedKey(row))}
                    >
                      <span>
                        <b>{row.asset.name}</b>
                        <small>
                          {CURRENCY_NAMES[row.asset.currency]}
                          {row.asset.heldAt === 'bank'
                            ? ' · bank account'
                            : row.asset.heldAt === 'cash'
                              ? ' · cash'
                              : ''}
                          {row.portfolioName ? ` · ${row.portfolioName}` : ''}
                        </small>
                      </span>
                    </button>
                  </td>
                  <td data-label="Held">
                    {units(row.v.units)} {row.asset.currency}
                  </td>
                  <td data-label="Avg cost">
                    {row.v.averageRate === null
                      ? '—'
                      : money(row.v.averageRate)}
                  </td>
                  <td data-label="Rate">
                    {row.v.rate ? money(row.v.rate.pkrPerUnit) : '—'}
                    <small>
                      {row.v.rate
                        ? `${row.v.rate.kind === 'open_market' ? 'open market' : 'interbank estimate'}${row.v.rate.stale ? ' · STALE' : ''}`
                        : 'No rate yet'}
                    </small>
                  </td>
                  <td data-label="Value">
                    {row.v.value === null ? 'Rate needed' : money(row.v.value)}
                  </td>
                  <td data-label="Gain / loss" className={tone(row.v.gain)}>
                    {row.v.gain === null
                      ? row.v.cost === null
                        ? 'cost not known'
                        : 'no value yet'
                      : signed(row.v.gain)}
                  </td>
                  <td data-label="Realised" className={tone(row.v.realized)}>
                    {row.v.realized === null
                      ? 'cost not known'
                      : signed(row.v.realized)}
                  </td>
                </tr>
              </tbody>
            ))}
          </table>
        </div>
      </CollapsiblePanel>
      {dialog}
    </>
  );
}

/** Rupees per unit over time: the interbank history with the open-market rate where it exists, and your own buys and sells on it. */
function RateChart({
  fx,
  asset,
}: {
  fx: FxRatesResponse;
  asset: CurrencyAsset;
}) {
  const currency = asset.currency;
  const interbank = fx.history.filter(
    (h) => h.currency === currency && h.kind === 'interbank',
  );
  const open = fx.history.filter(
    (h) => h.currency === currency && h.kind === 'open_market',
  );
  if (interbank.length < 2 && open.length < 2)
    return <p className="muted">No rate history yet.</p>;
  const main = interbank.length >= 2 ? interbank : open;
  const trades = currencyPosition(asset).history.filter(
    (e) =>
      !e.voided &&
      e.type !== 'opening' &&
      e.pkr !== null &&
      e.units > 0 &&
      e.date >= main[0].date,
  );
  return (
    <EChart
      className="company-chart"
      label={`${currency} in rupees over time, ${main.length} days. Latest ${money(main[main.length - 1].rate)}. ${trades.length} of your trades marked.`}
      build={(t) => {
        const days = main.map((d) => d.date);
        const openByDay = new Map(open.map((d) => [d.date, d.rate]));
        return timeSeriesOption(t, {
          name: interbank.length >= 2 ? 'Interbank' : 'Open market',
          data: main.map((d) => ({ x: d.date, y: d.rate })),
          valueFormat: money,
          axisFormat: (n) => money(n),
          zoom: true,
          dateLabel: (x) => dateText(String(x)),
          markers: trades.map((e) => ({
            x: e.date,
            y: e.pkr! / e.units,
            color: e.type === 'sell' ? t.danger : t.success,
            label: `${e.type === 'sell' ? 'Sold' : 'Bought'} ${units(e.units)} ${currency} at ${money(e.pkr! / e.units)}`,
            up: e.type === 'sell',
          })),
          extra:
            interbank.length >= 2 && open.length
              ? [
                  {
                    name: 'Open market',
                    data: days.map((d) => openByDay.get(d) ?? null),
                    color: t.warn,
                  },
                ]
              : undefined,
        });
      }}
    />
  );
}

/** Units held after each recorded purchase or sale, as a step line. */
function HeldChart({ asset }: { asset: CurrencyAsset }) {
  const points = currencyPosition(asset)
    .history.filter((e) => !e.voided)
    .map((e) => ({ x: e.date, y: e.heldAfter }));
  if (points.length < 2)
    return <p className="muted">Add a second entry to see this over time.</p>;
  return (
    <EChart
      className="company-chart"
      label={`${asset.currency} held after each entry. Now ${units(points[points.length - 1].y)}.`}
      build={(t) =>
        timeSeriesOption(t, {
          name: `${asset.currency} held`,
          data: [
            ...points,
            { x: today(), y: points[points.length - 1].y },
          ],
          step: true,
          area: true,
          includeZero: true,
          valueFormat: (n) => `${units(n)} ${asset.currency}`,
          axisFormat: (n) => units(n),
          dateLabel: (x) => dateText(String(x)),
        })
      }
    />
  );
}

function CurrencyEntryDialog({
  initialType,
  presetAssetId,
  editing,
  assets,
  fx,
  busy,
  onClose,
  onSave,
}: {
  initialType: CurrencyEntry['type'];
  presetAssetId?: string;
  /** Correct an existing entry in place instead of adding a new one. */
  editing?: { assetId: string; entry?: CurrencyEntry };
  assets: CurrencyAsset[];
  fx: FxRatesResponse;
  busy: boolean;
  onClose: () => void;
  onSave: (assets: CurrencyAsset[], message: string) => Promise<void>;
}) {
  const existing = editing?.entry;
  const [type, setType] = useState<CurrencyEntry['type']>(
    existing?.type ?? initialType,
  );
  const [assetId, setAssetId] = useState(
    editing?.assetId ??
      presetAssetId ??
      (initialType === 'sell' ? (assets[0]?.id ?? NEW) : NEW),
  );
  const [currency, setCurrency] = useState<CurrencyCode>('USD');
  const [heldAt, setHeldAt] = useState<'cash' | 'bank'>('cash');
  const [name, setName] = useState('');
  const [date, setDate] = useState(existing?.date ?? today());
  const [amount, setAmount] = useState(existing ? String(existing.units) : '');
  const [pkr, setPkr] = useState(
    existing?.pkr != null ? String(existing.pkr) : '',
  );
  const [note, setNote] = useState(existing?.note ?? '');
  const [error, setError] = useState('');

  const chosen = assets.find((a) => a.id === assetId);
  const code = chosen?.currency ?? currency;
  const count = Number(amount.replace(/,/g, ''));
  // A new purchase or sale is filled in from the public rate on the chosen date; overwrite it with the real figure.
  const estimate = useMemo(() => {
    if (existing || type === 'opening' || !(count > 0)) return null;
    const rate = chooseFxRate(fx.rates, code, date);
    return rate ? Math.round(rate.pkrPerUnit * count) : null;
  }, [existing, type, count, fx.rates, code, date]);
  const [seenEstimate, setSeenEstimate] = useState<number | null>(null);
  if (estimate !== seenEstimate) {
    setSeenEstimate(estimate);
    if (estimate !== null) setPkr(String(estimate));
  }
  const total = Number(pkr.replace(/,/g, ''));
  const perUnit = count > 0 && total > 0 ? total / count : null;

  async function submit(event: React.SyntheticEvent) {
    event.preventDefault();
    setError('');
    try {
      if (!(count > 0)) throw new Error('Enter the amount of currency.');
      if (type === 'sell' && !chosen)
        throw new Error('Choose which holding you sold from.');
      const unknownCost = type === 'opening' && pkr.trim() === '';
      const value = unknownCost ? null : total;
      if (!unknownCost && !(value! >= 0 && Number.isFinite(value)))
        throw new Error(
          type === 'sell'
            ? 'Enter the rupees you received.'
            : 'Enter the rupees you paid.',
        );
      const entry: CurrencyEntry = {
        ...existing,
        id:
          existing?.id ??
          `e-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`,
        type,
        date,
        units: Math.round(count * 1e4) / 1e4,
        pkr: value,
        note: note.trim(),
      };
      let next: CurrencyAsset[];
      if (chosen && existing)
        next = assets.map((a) =>
          a.id === chosen.id
            ? {
                ...a,
                entries: a.entries.map((e) =>
                  e.id === existing.id ? entry : e,
                ),
              }
            : a,
        );
      else if (chosen)
        next = assets.map((a) =>
          a.id === chosen.id ? { ...a, entries: [...a.entries, entry] } : a,
        );
      else
        next = [
          ...assets,
          {
            id: newAssetId(),
            kind: 'currency',
            name:
              name.trim() ||
              `${CURRENCY_NAMES[currency]} (${heldAt === 'bank' ? 'bank' : 'cash'})`,
            currency,
            heldAt,
            note: '',
            entries: [entry],
          },
        ];
      await onSave(
        next,
        existing
          ? 'Entry updated.'
          : type === 'sell'
            ? 'Sale recorded.'
            : 'Purchase recorded.',
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="form-dialog tx-dialog asset-dialog">
        <DialogTitle>
          {existing
            ? 'Edit entry'
            : type === 'sell'
              ? 'Record a sale'
              : type === 'opening'
                ? 'Opening balance'
                : 'Add foreign currency'}
        </DialogTitle>
        <DialogDescription>
          US dollars, UAE dirhams and Saudi riyals, tracked in rupees. Every
          purchase and sale stays in the history.
        </DialogDescription>
        <form onSubmit={(e) => void submit(e)}>
          <fieldset className="tx-types">
            <legend className="sr-only">Entry type</legend>
            {(['buy', 'sell', 'opening'] as const).map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={type === t}
                className={type === t ? 'compact' : 'secondary compact'}
                onClick={() => setType(t)}
              >
                {t === 'buy'
                  ? 'Bought'
                  : t === 'sell'
                    ? 'Sold'
                    : 'Already owned'}
              </button>
            ))}
          </fieldset>
          <div className="form-grid">
            {(type === 'sell' || assets.length > 0) && (
              <label className="wide">
                Holding
                <select
                  value={assetId}
                  onChange={(e) => setAssetId(e.target.value)}
                  disabled={!!existing}
                >
                  {type !== 'sell' && (
                    <option value={NEW}>
                      {assets.length
                        ? 'Choose or start a new holding'
                        : 'New holding'}
                    </option>
                  )}
                  {assets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {!chosen && type !== 'sell' && (
              <>
                <label>
                  Currency
                  <select
                    value={currency}
                    onChange={(e) =>
                      setCurrency(e.target.value as CurrencyCode)
                    }
                  >
                    {SUPPORTED_CURRENCIES.map((c) => (
                      <option key={c} value={c}>
                        {c} · {CURRENCY_NAMES[c]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Kept as
                  <select
                    value={heldAt}
                    onChange={(e) =>
                      setHeldAt(e.target.value as 'cash' | 'bank')
                    }
                  >
                    <option value="cash">Cash</option>
                    <option value="bank">Bank account</option>
                  </select>
                </label>
                <label className="wide">
                  Name (optional)
                  <input
                    value={name}
                    maxLength={80}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Dollars at home"
                  />
                </label>
              </>
            )}
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
            <label>
              Amount ({code})
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="e.g. 500"
              />
            </label>
            <label className="wide">
              {type === 'sell'
                ? 'Rupees received (Rs)'
                : type === 'opening'
                  ? 'What it cost you (Rs), leave empty if you do not know'
                  : 'Rupees paid (Rs), fees included'}
              <input
                inputMode="decimal"
                value={pkr}
                onChange={(e) => setPkr(e.target.value)}
              />
            </label>
            <label className="wide">
              Note (exchange company, receipt)
              <input
                value={note}
                maxLength={500}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
          </div>
          <p className="muted">
            Rate: {perUnit === null ? '—' : `${money(perUnit)} per ${code}`}
          </p>
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
