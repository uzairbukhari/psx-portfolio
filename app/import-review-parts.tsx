'use client';

import type { ReactNode } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import type { HoldingChange } from '@/lib/ahl-reconcile';
import type { SplitReview } from './use-split-review';
import './import-review.css';

/** Full-screen frame shared by every import review: pinned header and footer, scrolling body. */
export function ReviewShell({
  title, description, summary, busy, onCancel, primaryLabel, primaryDisabled, onPrimary, children,
}: {
  title: string;
  description: ReactNode;
  summary?: ReactNode;
  busy: boolean;
  onCancel: () => void;
  primaryLabel: string;
  primaryDisabled: boolean;
  onPrimary: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onCancel(); }}>
      <DialogContent className="import-review import-fullscreen top-0 left-0 translate-x-0 translate-y-0 sm:max-w-none">
        <div className="ir-head">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
          {summary && <div className="ir-summary">{summary}</div>}
        </div>
        <div className="ir-body">{children}</div>
        <div className="ir-foot">
          <button type="button" className="secondary" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" disabled={primaryDisabled} onClick={onPrimary}>{primaryLabel}</button>
        </div>
      </DialogContent>
    </Dialog>
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

/** Splits this import will add (from public evidence) and price breaks that might be an unrecorded split. */
export function SplitSection({ review }: { review: SplitReview }) {
  const { proposals, possible } = review;
  if (!proposals.length && !possible.length && !review.error && !review.loading) return null;
  return (
    <>
      <h3 className="ir-h">Stock splits</h3>
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
    </>
  );
}

export function HoldingsAfter({
  changes, newCompanies, companyState,
}: {
  changes: HoldingChange[];
  newCompanies: string[];
  companyState: Record<string, string | undefined>;
}) {
  if (!changes.length) return null;
  return (
    <>
      <h3 className="ir-h">Holdings after import</h3>
      <div className="ir-table-wrap">
        <table className="ir-table">
          <thead><tr><th>Symbol</th><th className="num">Shares before</th><th className="num">Shares after</th><th>Cost basis</th></tr></thead>
          <tbody>
            {changes.map((c) => (
              <tr key={c.ticker}>
                <td data-label="Symbol">
                  <b>{c.ticker}</b>
                  {newCompanies.includes(c.ticker) ? <small>new, not approved, 0% target</small> : null}
                  {newCompanies.includes(c.ticker) && companyState[c.ticker] !== 'resolved' ? (
                    <small>{companyState[c.ticker] === 'pending' ? 'company details being looked up' : companyState[c.ticker] === 'unresolved' ? 'company details pending: trades are kept' : 'checking company details…'}</small>
                  ) : null}
                </td>
                <td data-label="Shares before" className="num">{c.beforeShares}</td><td data-label="Shares after" className="num">{c.afterShares}</td>
                <td data-label="Cost basis">{c.afterCostKnown ? 'known' : 'unknown (no cost for some shares)'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function Notes({ warnings, blockers }: { warnings: string[]; blockers: string[] }) {
  return (
    <>
      {warnings.length > 0 && (
        <details className="ir-warnings"><summary>{warnings.length} note{warnings.length === 1 ? '' : 's'}</summary>
          <ul>{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </details>
      )}
      {blockers.length > 0 && <div className="ir-banner ir-warn" role="alert">{blockers.map((b, i) => <div key={i}>{b}</div>)}</div>}
    </>
  );
}
