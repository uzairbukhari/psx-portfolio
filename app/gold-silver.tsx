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
  describePieces,
  newAssetId,
  valueMetal,
  type MetalAsset,
  type MetalEntry,
} from '@/lib/assets';
import {
  KARATS,
  STANDARD_PIECES,
  tolaFromGrams,
  type Karat,
  type Metal,
  type MetalRateRow,
} from '@/lib/metal-rates';
import { money, moneyShort, today } from '@/lib/portfolio';
import AssetHistory, { type HistoryRow } from './asset-history';
import CollapsiblePanel from './collapsible-panel';

export type OwnedMetal = {
  asset: MetalAsset;
  portfolioId?: string;
  portfolioName?: string;
};
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

function historyRows(
  asset: MetalAsset,
  v: ReturnType<typeof valueMetal>,
  canEdit: boolean,
  busy: boolean,
  toggleVoid: (assetId: string, entryId: string) => Promise<void>,
): HistoryRow[] {
  return [...asset.entries]
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .map((e) => {
      const h = v.history.find((x) => x.id === e.id);
      const sale = e.type === 'sell';
      return {
        id: e.id,
        date: dateText(e.date),
        tag: e.type === 'sell' ? 'sell' : e.type === 'buy' ? 'buy' : 'neutral',
        tagLabel:
          e.type === 'opening'
            ? 'Opening'
            : e.type === 'buy'
              ? 'Bought'
              : 'Sold',
        title: `${describePieces(e)}${e.form ? ` · ${e.form}` : ''}`,
        note: e.note || undefined,
        amount:
          e.amount === null
            ? 'Cost unknown'
            : `${sale ? '+' : '−'}${money(e.amount)}`,
        amountTone: sale ? 'pos-text' : '',
        meta: [
          h ? `Holding ${grams(h.heldAfter)}` : '',
          h?.realizedGain != null ? `Gain ${signed(h.realizedGain)}` : '',
        ].filter(Boolean),
        voided: !!e.voided,
        action: canEdit
          ? {
              label: e.voided ? 'Restore' : 'Void',
              disabled: busy,
              onClick: () => void toggleVoid(asset.id, e.id),
            }
          : undefined,
      } satisfies HistoryRow;
    });
}

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
  onChange,
}: {
  owned: OwnedMetal[];
  rates: MetalRateRow[];
  ratesError: string;
  canEdit: boolean;
  busy: boolean;
  /** Bumped by the page's + menu to open the add dialog. */
  addRequest?: number;
  /** Receives this portfolio's complete asset list after an add, sale or void. */
  onChange: (assets: MetalAsset[], message: string) => Promise<void>;
}) {
  const asOf = today();
  const [open, setOpen] = useState<{
    type: MetalEntry['type'];
    assetId?: string;
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
      assets={assets}
      busy={busy}
      onClose={() => setOpen(null)}
      onSave={async (next, message) => {
        await onChange(next, message);
        setOpen(null);
      }}
    />
  ) : null;
  // A class you never used is not shown; one you have sold out stays, for its history.
  if (rows.length === 0) return dialog;

  return (
    <>
      <CollapsiblePanel
        id="gold-silver"
        title="Gold and silver"
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
        {rows.map(({ asset, v, portfolioName }) => (
          <article
            className="metal-asset"
            key={`${asset.id}-${portfolioName ?? ''}`}
          >
            <header className="metal-asset__head">
              <div>
                <b>{asset.name}</b>
                <small>
                  {asset.metal === 'gold' ? `${asset.karat}K gold` : 'Silver'}
                  {portfolioName ? ` · ${portfolioName}` : ''}
                </small>
              </div>
              <div className="metal-asset__value amount">
                {v.value === null ? 'Rate needed' : moneyShort(v.value)}
                <small className={tone(v.gain)}>
                  {v.gain === null
                    ? v.cost === null
                      ? 'cost not known'
                      : 'no value yet'
                    : `${signed(v.gain)}${v.gainPercent === null ? '' : ` · ${v.gainPercent >= 0 ? '+' : '−'}${Math.abs(v.gainPercent).toFixed(1)}%`}`}
                </small>
              </div>
            </header>
            <dl className="metal-asset__stats">
              <div>
                <dt>Held</dt>
                <dd>
                  {grams(v.grams)}
                  <small>{tolaFromGrams(v.grams).toFixed(2)} tola</small>
                </dd>
              </div>
              <div>
                <dt>Average cost</dt>
                <dd>
                  {v.averagePerGram === null
                    ? '—'
                    : `${money(v.averagePerGram * 11.6638)} / tola`}
                </dd>
              </div>
              <div>
                <dt>Bought / sold</dt>
                <dd>
                  {grams(v.bought.grams)} / {grams(v.sold.grams)}
                  <small>
                    {moneyShort(v.bought.amount)} in ·{' '}
                    {moneyShort(v.sold.amount)} out
                  </small>
                </dd>
              </div>
              <div>
                <dt>Realised gain</dt>
                <dd className={tone(v.realized)}>
                  {v.realized === null ? 'cost not known' : signed(v.realized)}
                </dd>
              </div>
            </dl>
            <p className="report-source">
              {v.rate
                ? `Priced at ${money(v.rate.pkrPerTola)} per tola of 24K ${asset.metal} · ${v.rate.kind === 'local' ? 'dealer rate' : 'international estimate converted to rupees'} · ${dateText(v.rate.date)}${v.rate.fellBack ? ' (the dealer rate is more than 2 days old)' : ''}${v.rate.stale ? ' · STALE' : ''}`
                : 'No rate available yet, so the value is not shown.'}
            </p>
            <AssetHistory
              summary={`${v.history.length} ${v.history.length === 1 ? 'entry' : 'entries'}${asset.entries.some((e) => e.voided) ? `, ${asset.entries.filter((e) => e.voided).length} voided` : ''}`}
              rows={historyRows(asset, v, canEdit, busy, toggleVoid)}
            />
          </article>
        ))}
      </CollapsiblePanel>
      {dialog}
    </>
  );
}

function MetalEntryDialog({
  initialType,
  assets,
  busy,
  onClose,
  onSave,
}: {
  initialType: MetalEntry['type'];
  assets: MetalAsset[];
  busy: boolean;
  onClose: () => void;
  onSave: (assets: MetalAsset[], message: string) => Promise<void>;
}) {
  const [type, setType] = useState<MetalEntry['type']>(initialType);
  const [assetId, setAssetId] = useState(
    initialType === 'sell' ? (assets[0]?.id ?? '') : '',
  );
  const [metal, setMetal] = useState<Metal>('gold');
  const [karat, setKarat] = useState<Karat>(24);
  const [form, setForm] = useState<'coin' | 'bar'>('coin');
  const [size, setSize] = useState('1 tola');
  const [pieces, setPieces] = useState('1');
  const [customGrams, setCustomGrams] = useState('');
  const [date, setDate] = useState(today());
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const chosen = assets.find((a) => a.id === assetId);
  const piece = STANDARD_PIECES.find((s) => s.label === size);
  const count = Math.floor(Number(pieces));
  const totalGrams =
    size === OTHER
      ? Number(customGrams)
      : (piece?.grams ?? 0) * (Number.isFinite(count) ? count : 0);

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
        id: `e-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`,
        type,
        date,
        grams: Math.round(totalGrams * 1e6) / 1e6,
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
      if (target)
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
        type === 'sell' ? 'Sale recorded.' : 'Purchase recorded.',
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="form-dialog tx-dialog">
        <DialogTitle>
          {type === 'sell'
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
