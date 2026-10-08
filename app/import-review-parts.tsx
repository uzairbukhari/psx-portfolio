'use client';

import { useState, type ReactNode } from 'react';
import { Check, ChevronDown, Lock, ShieldCheck, Sparkles } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import type { HoldingChange } from '@/lib/ahl-reconcile';
import { dayMonth, fmtFees, fmtPrice, fmtQty, fmtRs, groupByMonth, openTodos, type ReviewTodo } from '@/lib/import-review-format';
import type { SplitReview } from './use-split-review';
import './import-review.css';

/** Two-letter mark for the header: initials of the broker or file kind. */
const monogram = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || 'IM';

/**
 * Full-screen frame shared by every import review: pinned header and footer, a scrolling body with the review on the
 * left and a live summary on the right (above the review on phones). After a successful import it turns into a short
 * "done" screen instead of closing straight away.
 */
export function ReviewShell({
  title, subtitle, chips, destination, sidebar, footer, busy, onCancel, primaryLabel, primaryDisabled, onPrimary, onViewActivity, children,
}: {
  title: string;
  subtitle: ReactNode;
  chips?: ReactNode;
  destination: string;
  sidebar: ReactNode;
  footer: { text: string; ok: boolean };
  busy: boolean;
  onCancel: () => void;
  primaryLabel: string;
  primaryDisabled: boolean;
  /** Runs the import. Resolves with the message to show on the done screen; rejects when saving failed. */
  onPrimary: () => Promise<string | void>;
  onViewActivity?: () => void;
  children: ReactNode;
}) {
  const [done, setDone] = useState<string | null>(null);
  async function run() {
    try {
      setDone((await onPrimary()) || 'Import saved.');
    } catch {
      /* The save reports its own error; the review stays open so nothing is lost. */
    }
  }
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onCancel(); }}>
      <DialogContent className="import-review import-fullscreen top-0 left-0 translate-x-0 translate-y-0 sm:max-w-none">
        <div className="rv-head">
          <span className="rv-logo" aria-hidden>{monogram(title)}</span>
          <div className="rv-head-text">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{subtitle}</DialogDescription>
            {chips && <div className="rv-chips">{chips}</div>}
          </div>
          <span className="rv-dest">Into <b>{destination}</b></span>
        </div>
        {done ? (
          <output className="rv-done">
            <span className="rv-done-mark"><Check size={30} aria-hidden /></span>
            <h2>Import saved to {destination}</h2>
            <p>{done}</p>
            <div className="rv-done-actions">
              {onViewActivity && <button type="button" className="secondary" onClick={() => { onCancel(); onViewActivity(); }}>View in Activity</button>}
              <button type="button" onClick={onCancel}>Done</button>
            </div>
          </output>
        ) : (
          <>
            <div className="rv-body">
              <aside className="rv-side">{sidebar}</aside>
              <div className="rv-main">{children}</div>
            </div>
            <div className="rv-foot">
              <span className={`rv-why${footer.ok ? ' ok' : ''}`} aria-live="polite">{footer.text}</span>
              <span className="rv-sp" />
              <button type="button" className="secondary" onClick={onCancel} disabled={busy}>Cancel</button>
              <button type="button" disabled={primaryDisabled} onClick={() => void run()}>{busy ? 'Saving…' : primaryLabel}</button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Where the statement was read: on this device, from a saved format, or by the AI service. */
export function MethodChip({ method }: { method: 'local' | 'saved' | 'ai' | 'browser' }) {
  if (method === 'ai') return <span className="rv-chip ai"><Sparkles size={12} aria-hidden /> Read with AI, review carefully</span>;
  return (
    <span className="rv-chip ok"><ShieldCheck size={12} aria-hidden /> {method === 'saved' ? 'Read on this device with a saved format' : 'Read on this device, no AI'}</span>
  );
}

export function StaleBanner({ onRefresh }: { onRefresh: () => void }) {
  return (
    <div className="ir-banner ir-warn" role="alert">
      Your portfolio changed while this preview was open. The preview below was recomputed from the latest ledger; review it again.
      <button type="button" className="secondary compact" onClick={onRefresh}>Review updated preview</button>
    </div>
  );
}

export type ReviewTile = { key: string; value: number; label: string; warn?: boolean; filter?: string };

/** The headline counts. Tiles with a `filter` narrow the row list when clicked. */
export function StatTiles({ tiles, active, onFilter }: { tiles: ReviewTile[]; active: string; onFilter: (filter: string) => void }) {
  return (
    <div className="rv-tiles">
      {tiles.map((t) => {
        const body = <><b>{t.value}</b><span>{t.label}</span></>;
        const cls = `rv-tile${t.warn && t.value > 0 ? ' warn' : ''}`;
        return t.filter ? (
          <button key={t.key} type="button" className={cls} aria-pressed={active === t.filter} onClick={() => onFilter(active === t.filter ? 'all' : t.filter!)}>{body}</button>
        ) : (
          <div key={t.key} className={cls}>{body}</div>
        );
      })}
    </div>
  );
}

/** A numbered card. The badge turns into a tick when `state` is done and an amber number while something is open. */
export function ReviewSection({ id, step, title, meta, state = 'idle', right, children }: {
  id?: string;
  step?: number;
  title: string;
  meta?: ReactNode;
  state?: 'idle' | 'todo' | 'done';
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rv-sec" id={id}>
      <div className="rv-sec-head">
        {step !== undefined && <span className={`rv-step ${state}`} aria-hidden>{state === 'done' ? <Check size={13} /> : step}</span>}
        <h2>{title}</h2>
        {meta && <span className="rv-meta">{meta}</span>}
        {right && <span className="rv-right">{right}</span>}
      </div>
      {children}
    </section>
  );
}

export function FilterChips({ options, value, onChange }: { options: { key: string; label: string; count: number }[]; value: string; onChange: (key: string) => void }) {
  return (
    <fieldset className="rv-filters" aria-label="Filter rows">
      {options.map((o) => (
        <button key={o.key} type="button" className="rv-filter" aria-pressed={value === o.key} onClick={() => onChange(o.key)}>{o.label} {o.count}</button>
      ))}
    </fieldset>
  );
}

export type ReviewRowData = {
  key: string;
  /** Element id the checklist scrolls to. */
  anchor: string;
  date: string;
  side: 'buy' | 'sell';
  /** Replaces the BUY/SELL text, for example "IPO". */
  sideLabel?: string;
  ticker: string;
  name?: string;
  tag?: string;
  qty: number;
  /** Null when no price could be worked out; the row then shows only the quantity. */
  price: number | null;
  fees?: number;
  /** Small line under the price (for example "average of fills"). */
  priceNote?: string;
  value?: number;
  status: { label: string; tone: 'new' | 'dup' | 'amb' | 'off' };
  control: ReactNode;
  /** Which filter chip this row belongs to. */
  group: 'new' | 'decide' | 'recorded' | 'skipped';
  dim?: boolean;
  attention?: boolean;
  notes?: string[];
  /** Full-width content under the row, for example the side-by-side comparison. */
  extra?: ReactNode;
};

/** Trades grouped by month: a coloured side pill, symbol, quantity at price, value, status and the decision control. */
export function ReviewRows({ rows, empty = 'Nothing in this view.' }: { rows: ReviewRowData[]; empty?: string }) {
  if (!rows.length) return <p className="rv-empty">{empty}</p>;
  return (
    <div className="rv-rows">
      {groupByMonth(rows).map((group) => (
        <div key={group.label}>
          <div className="rv-month">{group.label}</div>
          <ul>
            {group.rows.map((r) => (
              <li key={r.key} id={r.anchor} className={`rv-row${r.attention ? ' amb' : ''}${r.dim ? ' off' : ''}`}>
                <span className="rv-date">{dayMonth(r.date)}</span>
                <span className={`rv-side-pill ${r.side}`}>{r.sideLabel ?? (r.side === 'buy' ? 'BUY' : 'SELL')}</span>
                <span className="rv-sym"><b>{r.ticker}</b>{r.tag && <span className="rv-tag">{r.tag}</span>}{r.name && <small>{r.name}</small>}</span>
                <span className="rv-qty"><b>{fmtQty(r.qty)}{r.price ? ` @ ${fmtPrice(r.price)}` : ' shares'}</b>{(r.fees !== undefined || r.priceNote) && <small>{r.fees !== undefined ? `fees ${fmtFees(r.fees)}` : ''}{r.fees !== undefined && r.priceNote ? ' · ' : ''}{r.priceNote ?? ''}</small>}</span>
                <span className="rv-val">{r.value !== undefined ? fmtRs(r.value) : ''}</span>
                <span className={`rv-status ${r.status.tone}`}>{r.status.label}</span>
                <span className="rv-ctl">{r.control}</span>
                {r.notes?.length ? <span className="rv-notes">{r.notes.map((n, i) => <small key={i}>{n}</small>)}</span> : null}
                {r.extra}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** On or off for one row. A real switch, so it reads correctly to screen readers. */
export function RowSwitch({ on, label, onChange }: { on: boolean; label: string; onChange: (on: boolean) => void }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className="rv-switch" onClick={() => onChange(!on)} />;
}

/** The two-way choice for a row that may already be in the ledger, with both versions side by side. */
export function DecisionCompare({ statement, ledger, value, onChange, skipLabel = 'Same trade, skip', importLabel = 'Different, import' }: {
  statement: ReactNode;
  ledger: ReactNode;
  value: 'import' | 'skip' | undefined;
  onChange: (value: 'import' | 'skip') => void;
  skipLabel?: string;
  importLabel?: string;
}) {
  return (
    <div className="rv-compare">
      <div><small>On the statement</small>{statement}</div>
      <div><small>Already in your ledger</small>{ledger}</div>
      <fieldset className="rv-seg" aria-label="Is this the same trade?">
        <button type="button" aria-pressed={value === 'skip'} onClick={() => onChange('skip')}>{skipLabel}</button>
        <button type="button" aria-pressed={value === 'import'} onClick={() => onChange('import')}>{importLabel}</button>
      </fieldset>
    </div>
  );
}

/** Right-hand column: what the import will add (live), the checklist, statement notes and the privacy line. On phones it folds behind one line. */
export function ReviewSidebar({ big, sub, lines, todos, warnings, privacy = 'Nothing is saved until you press Import.' }: {
  big: string;
  sub: string;
  lines: [string, ReactNode][];
  todos: ReviewTodo[];
  warnings: string[];
  privacy?: string;
}) {
  const [open, setOpen] = useState(false);
  const left = openTodos(todos);
  return (
    <div className={`rv-sidebar${open ? ' open' : ''}`}>
      <button type="button" className="rv-side-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span>{big}{left ? ` · ${left} to decide` : ''}</span><ChevronDown size={16} aria-hidden />
      </button>
      <div className="rv-side-content">
        <div className="accent rv-result">
          <h3>This import will add</h3>
          <div className="rv-big">{big}</div>
          <p>{sub}</p>
          <ul>{lines.map(([label, value]) => <li key={label}><span>{label}</span><b>{value}</b></li>)}</ul>
        </div>
        <h3 className="rv-side-h">Before you import</h3>
        <ul className="rv-todo">
          {todos.length === 0 && <li className="done all"><span className="dot"><Check size={11} aria-hidden /></span><span>Everything is checked.</span></li>}
          {todos.map((t) => (
            <li key={t.key} className={t.done ? 'done' : 'open'}>
              <span className="dot">{t.done ? <Check size={11} aria-hidden /> : '!'}</span>
              <span>{t.text}</span>
              {!t.done && t.anchor && (
                <button type="button" className="rv-link" onClick={() => { setOpen(false); document.getElementById(t.anchor!)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}>Go</button>
              )}
            </li>
          ))}
        </ul>
        {warnings.length > 0 && (
          <details className="rv-notes-box">
            <summary>{warnings.length} note{warnings.length === 1 ? '' : 's'} from the statement</summary>
            <ul>{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          </details>
        )}
        <p className="rv-privacy"><Lock size={13} aria-hidden /> {privacy}</p>
      </div>
    </div>
  );
}

/** Splits this import will add (from public evidence) and price breaks that might be an unrecorded split. */
export function SplitSection({ review }: { review: SplitReview }) {
  const { proposals, possible } = review;
  if (!proposals.length && !possible.length && !review.error && !review.loading) return null;
  return (
    <ReviewSection title="Stock splits" state={proposals.length || possible.length ? 'todo' : 'idle'}>
      <div className="rv-pad">
        {review.loading && <p className="muted">Checking for stock splits…</p>}
        {review.error && <div className="ir-banner ir-warn" role="alert">{review.error}</div>}
        {proposals.length > 0 && (
          <p className="muted">
            These splits happened after you started trading the company, and your ledger does not have them yet. Trades keep the quantity and price the broker
            reported; the split converts your earlier shares. Untick one to leave it out.
          </p>
        )}
        {proposals.map((p) => (
          <div key={p.key} className="ir-assumed">
            <label className="ir-toggle">
              <input type="checkbox" checked={review.checked[p.key]} onChange={(e) => review.setChecked(p.key, e.target.checked)} />
              <span><b>{p.ticker}</b>: {p.newShares}-for-{p.oldShares} split, effective {p.date}</span>
            </label>
            <small>
              Source ({p.verification === 'curated' ? 'checked by hand' : 'read from documents by code'}):{' '}
              <a href={p.sourceUrl} target="_blank" rel="noreferrer">{p.sourceLabel ?? p.sourceUrl}</a>
            </small>
          </div>
        ))}
        {possible.length > 0 && (
          <>
            <p className="muted">
              These prices fall by half or more between two trades with no split recorded. If that was a split, fill in the ratio and date and tick it; otherwise ignore it.
            </p>
            {possible.map((item) => {
              const e = review.edits[item.key];
              return (
                <div key={item.key} className="ir-assumed">
                  <span><b>{item.ticker}</b>: Rs {item.fromPrice} on {item.fromDate} then Rs {item.toPrice} on {item.toDate}. Possible split.</span>
                  <span className="ir-inline">
                    <label className="ir-toggle"><input type="checkbox" checked={e.checked} onChange={(ev) => review.setEdit(item, { checked: ev.target.checked })} /> Add this split</label>
                    <label>Old shares <input type="number" min="1" step="1" value={e.oldShares} onChange={(ev) => review.setEdit(item, { oldShares: Number(ev.target.value) })} /></label>
                    <label>New shares <input type="number" min="2" step="1" value={e.newShares} onChange={(ev) => review.setEdit(item, { newShares: Number(ev.target.value) })} /></label>
                    <label>Effective date <input type="date" value={e.date} onChange={(ev) => review.setEdit(item, { date: ev.target.value })} /></label>
                  </span>
                </div>
              );
            })}
          </>
        )}
      </div>
    </ReviewSection>
  );
}

/** Before → after share counts as bars, with a +/- change. Renders the rows only; wrap it in a ReviewSection. */
export function HoldingsAfter({
  changes, newCompanies, companyState,
}: {
  changes: HoldingChange[];
  newCompanies: string[];
  /** Company lookup progress per new symbol. Leave out when the dialog does not look companies up. */
  companyState?: Record<string, string | undefined>;
}) {
  if (!changes.length) return <p className="rv-empty">No holding changes.</p>;
  const max = Math.max(1, ...changes.flatMap((c) => [c.beforeShares, c.afterShares]));
  return (
    <ul className="rv-holds">
      {changes.map((c) => {
        const delta = c.afterShares - c.beforeShares;
        const low = Math.min(c.beforeShares, c.afterShares);
        const isNew = newCompanies.includes(c.ticker);
        return (
          <li key={c.ticker} className="rv-hold">
            <span className="rv-sym">
              <b>{c.ticker}</b>{isNew && <span className="rv-tag">NEW</span>}
              {isNew && companyState && companyState[c.ticker] !== 'resolved' && (
                <small>{companyState[c.ticker] === 'pending' ? 'company details being looked up' : companyState[c.ticker] === 'unresolved' ? 'company details pending: trades are kept' : 'checking company details…'}</small>
              )}
              {isNew && <small>not approved, 0% target</small>}
              {!c.afterCostKnown && <small>cost unknown for some shares</small>}
            </span>
            <span className="rv-bar" aria-hidden>
              <i style={{ width: `${(low / max) * 100}%` }} />
              <em className={delta < 0 ? 'neg' : ''} style={{ left: `${(low / max) * 100}%`, width: `${(Math.abs(delta) / max) * 100}%` }} />
            </span>
            <span className={`rv-delta${delta < 0 ? ' neg' : ''}`}>{fmtQty(c.beforeShares)} → {fmtQty(c.afterShares)} <b>{delta > 0 ? '+' : ''}{fmtQty(delta)}</b></span>
          </li>
        );
      })}
    </ul>
  );
}
