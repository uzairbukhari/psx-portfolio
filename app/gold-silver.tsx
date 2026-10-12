'use client';

import { ownedKey } from './asset-keys';
import { useMemo, useState } from 'react';
import { ArrowLeft, Plus } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  newAssetId,
  valueMetal,
  type MetalAsset,
  type MetalEntry,
} from '@/lib/assets';
import {
  KARATS,
  STANDARD_PIECES,
  chooseRate,
  purity,
  tolaFromGrams,
  type Karat,
  type Metal,
  type MetalRateRow,
} from '@/lib/metal-rates';
import { money, moneyShort, today } from '@/lib/portfolio';
import LedgerTimeline from './ledger-timeline';
import { NO_STOCKS, buildAssetEntries } from '@/lib/ledger-entries';
import CollapsiblePanel from './collapsible-panel';

export type OwnedMetal = {
  asset: MetalAsset;
  portfolioId?: string;
  portfolioName?: string;
};
const ENTRY_HISTORY_LENGTH =
  typeof window === 'undefined' ? 0 : window.history.length;
const tone = (n: number | null) =>
  n === null ? '' : n >= 0 ? 'pos-text' : 'neg-text';
const signed = (n: number) => `${n >= 0 ? '+' : '−'}${moneyShort(Math.abs(n))}`;
const grams = (n: number) => `${Math.round(n * 1000) / 1000} g`;
const dateText = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
const OTHER = 'other';

/**
 * Gold and silver coins and bars: current value, and the full history of every purchase and sale. Values come from
 * public rates and are calculated here, on the device. In the All view it is read-only (open a portfolio to edit).
 */
export default function GoldSilverSection({
  owned,
  rates,
  ratesError,
  canEdit,
  busy,
  addRequest = 0,
  focusKey,
  onOpenAsset,
  onBack,
  onSwitchPortfolio,
  onChange,
}: {
  owned: OwnedMetal[];
  rates: MetalRateRow[];
  ratesError: string;
  canEdit: boolean;
  busy: boolean;
  /** Bumped by the page's + menu to open the add dialog. */
  addRequest?: number;
  /** Shows that one holding's page instead of the tables. */
  focusKey?: string;
  onOpenAsset?: (key: string) => void;
  onBack?: () => void;
  /** On the All view a holding can only be edited inside its own portfolio; this switches to it. */
  onSwitchPortfolio?: (key: string) => void;
  /** Receives this portfolio's complete asset list after an add, sale or void. */
  onChange: (assets: MetalAsset[], message: string) => Promise<void>;
}) {
  const asOf = today();
  const [open, setOpen] = useState<{
    type: MetalEntry['type'];
    assetId?: string;
    entryId?: string;
  } | null>(null);
  const [error, setError] = useState('');
  const rows = useMemo(
    () => owned.map((o) => ({ ...o, v: valueMetal(o.asset, rates, asOf) })),
    [owned, rates, asOf],
  );
  const assets = owned.map((o) => o.asset);
  // Open the add dialog when the page's + menu asks for it (set during render, not in an effect).
  const [seenRequest, setSeenRequest] = useState(addRequest);
  if (addRequest !== seenRequest) {
    setSeenRequest(addRequest);
    if (addRequest > 0 && canEdit) setOpen({ type: 'buy' });
  }
  const groups = useMemo(
    () =>
      (['gold', 'silver'] as const).flatMap((metal) => {
        const list = rows.filter((r) => r.asset.metal === metal);
        return list.length === 0
          ? []
          : [
              {
                metal,
                rows: list,
                value: list.every((r) => r.v.value !== null)
                  ? list.reduce((a, r) => a + (r.v.value ?? 0), 0)
                  : null,
                gain: list.every((r) => r.v.gain !== null)
                  ? list.reduce((a, r) => a + (r.v.gain ?? 0), 0)
                  : null,
              },
            ];
      }),
    [rows],
  );
  const totals = useMemo(() => {
    const known = rows.every((r) => r.v.value !== null);
    const gainKnown = rows.every((r) => r.v.gain !== null);
    return {
      value: known ? rows.reduce((a, r) => a + (r.v.value ?? 0), 0) : null,
      gain: gainKnown ? rows.reduce((a, r) => a + (r.v.gain ?? 0), 0) : null,
      cost: rows.every((r) => r.v.cost !== null)
        ? rows.reduce((a, r) => a + (r.v.cost ?? 0), 0)
        : null,
      held: rows.filter((r) => r.v.grams > 0).length,
    };
  }, [rows]);

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
    <MetalEntryDialog
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
      rates={rates}
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
              {asset.metal === 'gold' ? `${asset.karat}K GOLD` : 'SILVER'}
            </p>
            <h1>{asset.name}</h1>
            <p>{row.portfolioName ?? ''}</p>
          </div>
          <div className="company-price">
            <strong>{v.rate ? money(v.rate.pkrPerTola) : '—'}</strong>
            <small>
              {v.rate
                ? `per tola of 24K ${asset.metal} · ${dateText(v.rate.date)}`
                : 'No rate yet'}
            </small>
          </div>
          {canEdit && (
            <div className="company-actions">
              <button disabled={busy} onClick={() => setOpen({ type: 'buy' })}>
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
        {ratesError && (
          <p className="notice">
            Could not load today&apos;s rates: {ratesError}
          </p>
        )}
        {error && <p className="notice error">{error}</p>}
        <div className="company-cards">
          <article>
            <span>Held</span>
            <strong>{grams(v.grams)}</strong>
            <small>{tolaFromGrams(v.grams).toFixed(2)} tola</small>
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
              Bought {moneyShort(v.bought.amount)} · sold{' '}
              {moneyShort(v.sold.amount)}
            </small>
          </article>
        </div>
        <p className="report-source">
          {v.rate
            ? `Priced at ${money(v.rate.pkrPerTola)} per tola of 24K ${asset.metal} · ${v.rate.kind === 'local' ? 'dealer rate' : 'international estimate converted to rupees'}${v.rate.fellBack ? ' (the dealer rate is more than 2 days old)' : ''}${v.rate.stale ? ' · STALE' : ''}`
            : 'No rate available yet, so the value is not shown.'}
        </p>
        <section className="company-section">
          <h2>Activity</h2>
          <LedgerTimeline
            portfolio={NO_STOCKS}
            ticker={asset.name}
            hideKpis
            entries={buildAssetEntries([{ asset }], () => undefined, {
              correct: (_a, entryId) =>
                setOpen({ type: 'buy', assetId: asset.id, entryId }),
              toggleVoid: (_a, entryId) => void toggleVoid(asset.id, entryId),
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
        id="gold-silver"
        title="Gold and Silver"
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
                <span className="holdings-add__label">Add gold or silver</span>
              </button>
            </>
          )
        }
      >
        {ratesError && (
          <p className="notice">
            Could not load today&apos;s rates: {ratesError}
          </p>
        )}
        {error && <p className="notice error">{error}</p>}
        {groups.map((g) => (
          <section className="fund-group" key={g.metal}>
            <header className="fund-group__head">
              <div>
                <b>{g.metal === 'gold' ? 'Gold' : 'Silver'}</b>
                <small>
                  {g.rows.length} {g.rows.length === 1 ? 'holding' : 'holdings'}
                </small>
              </div>
              <div className="fund-group__totals amount">
                {g.value === null ? 'Rate needed' : moneyShort(g.value)}
                <small className={tone(g.gain)}>
                  {g.gain === null ? 'gain not known' : signed(g.gain)}
                </small>
              </div>
            </header>
            <div className="fund-table-wrap">
              <table className="fund-table">
                <thead>
                  <tr>
                    <th>Holding</th>
                    <th>Held</th>
                    <th>Avg cost / tola</th>
                    <th>Rate / tola</th>
                    <th>Value</th>
                    <th>Gain / loss</th>
                    <th>Realised</th>
                  </tr>
                </thead>
                {g.rows.map((row) => (
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
                              {row.asset.metal === 'gold'
                                ? `${row.asset.karat}K gold`
                                : 'Silver'}
                              {row.portfolioName
                                ? ` · ${row.portfolioName}`
                                : ''}
                            </small>
                          </span>
                        </button>
                      </td>
                      <td data-label="Held">
                        {grams(row.v.grams)}
                        <small>
                          {tolaFromGrams(row.v.grams).toFixed(2)} tola
                        </small>
                      </td>
                      <td data-label="Avg cost / tola">
                        {row.v.averagePerGram === null
                          ? '—'
                          : money(row.v.averagePerGram * 11.6638)}
                      </td>
                      <td data-label="Rate / tola">
                        {row.v.rate ? (
                          <>
                            {money(row.v.rate.pkrPerTola)}
                            <small>{dateText(row.v.rate.date)}</small>
                          </>
                        ) : (
                          <small>No rate yet</small>
                        )}
                      </td>
                      <td data-label="Value" className="amount">
                        {row.v.value === null
                          ? 'Rate needed'
                          : moneyShort(row.v.value)}
                      </td>
                      <td data-label="Gain / loss" className={tone(row.v.gain)}>
                        {row.v.gain === null
                          ? row.v.cost === null
                            ? 'cost not known'
                            : 'no value yet'
                          : signed(row.v.gain)}
                      </td>
                      <td
                        data-label="Realised"
                        className={tone(row.v.realized)}
                      >
                        {row.v.realized === null
                          ? 'cost not known'
                          : signed(row.v.realized)}
                      </td>
                    </tr>
                  </tbody>
                ))}
              </table>
            </div>
          </section>
        ))}
      </CollapsiblePanel>
      {dialog}
    </>
  );
}

function MetalEntryDialog({
  initialType,
  presetAssetId,
  editing,
  assets,
  rates,
  busy,
  onClose,
  onSave,
}: {
  initialType: MetalEntry['type'];
  /** Pre-selects the holding when opened from its own page. */
  presetAssetId?: string;
  /** Correct an existing entry in place instead of adding a new one. */
  editing?: { assetId: string; entry?: MetalEntry };
  assets: MetalAsset[];
  rates: MetalRateRow[];
  busy: boolean;
  onClose: () => void;
  onSave: (assets: MetalAsset[], message: string) => Promise<void>;
}) {
  const existing = editing?.entry;
  const existingPiece = existing?.pieceGrams
    ? STANDARD_PIECES.find((s) => s.grams === existing.pieceGrams)
    : undefined;
  const [type, setType] = useState<MetalEntry['type']>(
    existing?.type ?? initialType,
  );
  const [assetId, setAssetId] = useState(
    editing?.assetId ??
      presetAssetId ??
      (initialType === 'sell' ? (assets[0]?.id ?? '') : ''),
  );
  const [metal, setMetal] = useState<Metal>('gold');
  const [karat, setKarat] = useState<Karat>(24);
  const [form, setForm] = useState<'coin' | 'bar'>(existing?.form ?? 'coin');
  const [size, setSize] = useState(
    existing ? (existingPiece?.label ?? OTHER) : '1 tola',
  );
  const [pieces, setPieces] = useState(String(existing?.pieces ?? 1));
  const [customGrams, setCustomGrams] = useState(
    existing && !existingPiece ? String(existing.grams) : '',
  );
  const [date, setDate] = useState(existing?.date ?? today());
  const [amount, setAmount] = useState(
    existing?.amount != null ? String(existing.amount) : '',
  );
  const [note, setNote] = useState(existing?.note ?? '');
  const [error, setError] = useState('');

  const chosen = assets.find((a) => a.id === assetId);
  const piece = STANDARD_PIECES.find((s) => s.label === size);
  const count = Math.floor(Number(pieces));
  const totalGrams =
    size === OTHER
      ? Number(customGrams)
      : (piece?.grams ?? 0) * (Number.isFinite(count) ? count : 0);

  // A new purchase or sale is filled in from the public rate on the chosen date; you can overwrite it with the real figure.
  const rateMetal = chosen?.metal ?? metal;
  const rateKarat = rateMetal === 'silver' ? 24 : (chosen?.karat ?? karat);
  const estimate = useMemo(() => {
    if (existing || type === 'opening' || !(totalGrams > 0)) return null;
    const rate = chooseRate(rates, rateMetal, date);
    if (!rate) return null;
    return Math.round(rate.pkrPerGram * purity(rateKarat) * totalGrams);
  }, [existing, type, totalGrams, rates, rateMetal, rateKarat, date]);
  const [seenEstimate, setSeenEstimate] = useState<number | null>(null);
  if (estimate !== seenEstimate) {
    setSeenEstimate(estimate);
    if (estimate !== null) setAmount(String(estimate));
  }

  async function submit(event: React.SyntheticEvent) {
    event.preventDefault();
    setError('');
    try {
      if (!(totalGrams > 0)) throw new Error('Enter the weight.');
      if (type === 'sell' && !chosen)
        throw new Error('Choose which holding you sold from.');
      const unknownCost = type === 'opening' && amount.trim() === '';
      const value = unknownCost ? null : Number(amount.replace(/,/g, ''));
      if (!unknownCost && !(value! >= 0 && Number.isFinite(value)))
        throw new Error(
          type === 'sell'
            ? 'Enter the amount you received.'
            : 'Enter the amount you paid.',
        );
      const entry: MetalEntry = {
        ...(existing ?? {}),
        id:
          existing?.id ??
          `e-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`,
        type,
        date,
        grams: Math.round(totalGrams * 1e6) / 1e6,
        pieces: undefined,
        pieceGrams: undefined,
        ...(size !== OTHER && piece
          ? { pieces: count, pieceGrams: piece.grams }
          : {}),
        form,
        amount: value,
        note: note.trim(),
      };
      let next: MetalAsset[];
      const target =
        chosen ??
        (type === 'sell'
          ? undefined
          : assets.find(
              (a) =>
                a.metal === metal && (metal === 'silver' || a.karat === karat),
            ));
      if (existing && target)
        next = assets.map((a) =>
          a.id === target.id
            ? {
                ...a,
                entries: a.entries.map((e) =>
                  e.id === existing.id ? entry : e,
                ),
              }
            : a,
        );
      else if (target)
        next = assets.map((a) =>
          a.id === target.id ? { ...a, entries: [...a.entries, entry] } : a,
        );
      else
        next = [
          ...assets,
          {
            id: newAssetId(),
            kind: 'metal',
            name: metal === 'gold' ? `Gold ${karat}K` : 'Silver',
            metal,
            karat: metal === 'gold' ? karat : 24,
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
                : 'Add gold or silver'}
        </DialogTitle>
        <DialogDescription>
          Coins and bars only. Every purchase and sale stays in the history.
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
                    <option value="">
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
                  Metal
                  <select
                    value={metal}
                    onChange={(e) => setMetal(e.target.value as Metal)}
                  >
                    <option value="gold">Gold</option>
                    <option value="silver">Silver</option>
                  </select>
                </label>
                {metal === 'gold' && (
                  <label>
                    Purity
                    <select
                      value={karat}
                      onChange={(e) =>
                        setKarat(Number(e.target.value) as Karat)
                      }
                    >
                      {KARATS.map((k) => (
                        <option key={k} value={k}>
                          {k}K{k === 24 ? ' (pure)' : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
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
              Coin or bar
              <select
                value={form}
                onChange={(e) => setForm(e.target.value as 'coin' | 'bar')}
              >
                <option value="coin">Coin</option>
                <option value="bar">Bar</option>
              </select>
            </label>
            <label>
              Size of each piece
              <select value={size} onChange={(e) => setSize(e.target.value)}>
                {STANDARD_PIECES.map((s) => (
                  <option key={s.label}>{s.label}</option>
                ))}
                <option value={OTHER}>Other weight (grams)</option>
              </select>
            </label>
            {size === OTHER ? (
              <label>
                Weight in grams
                <input
                  inputMode="decimal"
                  value={customGrams}
                  onChange={(e) => setCustomGrams(e.target.value)}
                  placeholder="e.g. 7.5"
                />
              </label>
            ) : (
              <label>
                How many pieces
                <input
                  inputMode="numeric"
                  value={pieces}
                  onChange={(e) => setPieces(e.target.value)}
                />
              </label>
            )}
            <label className="wide">
              {type === 'sell'
                ? 'Amount received (Rs)'
                : type === 'opening'
                  ? 'What it cost you (Rs), leave empty if you do not know'
                  : 'Amount paid (Rs), premium and fees included'}
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <label className="wide">
              Note (dealer, receipt)
              <input
                value={note}
                maxLength={500}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
          </div>
          <p className="muted">
            Total weight:{' '}
            {totalGrams > 0
              ? `${grams(totalGrams)} · ${tolaFromGrams(totalGrams).toFixed(3)} tola`
              : '—'}
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
