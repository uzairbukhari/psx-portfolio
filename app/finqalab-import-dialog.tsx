'use client';

import { useMemo, useState } from 'react';
import { applyFinqalabPlan, finqalabPlanIsNoop, planFinqalabImport, type FinqalabResolution, type FinqalabRowStatus, type FinqalabTrade } from './finqalab-import';
import { money, type Portfolio } from '@/lib/portfolio';
import { useCompanyStates } from './use-company-lookup';
import { HoldingsAfter, Notes, ReviewShell, SplitSection, StaleBanner } from './import-review-parts';
import { useSplitReview } from './use-split-review';

const STATUS_LABEL: Record<FinqalabRowStatus, string> = {
  new: 'New', duplicate: 'Already in ledger', 'previously-removed': 'Removed earlier', ambiguous: 'Needs decision',
};

export function FinqalabImportDialog({
  rows, fileName, portfolio, revision, busy, onCancel, onCommit,
}: {
  rows: FinqalabTrade[];
  fileName: string;
  portfolio: Portfolio;
  revision: number;
  busy: boolean;
  onCancel: () => void;
  onCommit: (next: Portfolio, message: string) => Promise<void>;
}) {
  const [resolutions, setResolutions] = useState<Record<string, FinqalabResolution>>({});
  const [showAll, setShowAll] = useState(false);
  const [reviewedRevision, setReviewedRevision] = useState(revision);
  const stale = revision !== reviewedRevision;

  const activity = useMemo(() => rows.map((r) => ({ ticker: r.ticker, date: r.date, price: r.price })), [rows]);
  const splitReview = useSplitReview(portfolio, activity);
  const plan = useMemo(
    () => planFinqalabImport(portfolio, rows, { resolutions, splits: splitReview.splits }),
    [portfolio, rows, resolutions, splitReview.splits],
  );
  const companyState = useCompanyStates(plan.newCompanies);
  const noop = finqalabPlanIsNoop(plan);
  const shown = plan.rows.filter((r) => showAll || r.status !== 'duplicate');
  const canImport = !stale && !plan.blockers.length && !noop && !busy;
  const resolve = (id: string, patch: FinqalabResolution) => setResolutions((r) => ({ ...r, [id]: { ...r[id], ...patch } }));

  async function commit() {
    const next = applyFinqalabPlan(portfolio, plan);
    const parts = [
      `${plan.counts.imported} Finqalab trade${plan.counts.imported === 1 ? '' : 's'} imported`,
      plan.splits.length ? `${plan.splits.length} stock split${plan.splits.length === 1 ? '' : 's'} added` : '',
      plan.counts.duplicate ? `${plan.counts.duplicate} already in your ledger` : '',
      plan.newCompanies.length ? `added ${plan.newCompanies.length} unapproved compan${plan.newCompanies.length === 1 ? 'y' : 'ies'}` : '',
    ].filter(Boolean);
    await onCommit(next, parts.join('. ') + '.');
  }

  const buys = rows.filter((r) => r.kind === 'buy').length;
  return (
    <ReviewShell
      title="Review Finqalab import"
      description={`${fileName} · ${plan.range.from} to ${plan.range.to}. Nothing is saved until you import. The report was read in your browser; it was not uploaded.`}
      summary={
        <>
          <span><b>{rows.length}</b> trades ({buys} buys, {rows.length - buys} sells)</span>
          <span><b>{plan.counts.imported}</b> to import</span>
          <span><b>{plan.counts.duplicate}</b> already in ledger</span>
          {plan.counts.ambiguous > 0 && <span><b>{plan.counts.ambiguous}</b> need a decision</span>}
          {plan.counts.removed > 0 && <span><b>{plan.counts.removed}</b> removed earlier</span>}
          {plan.splits.length > 0 && <span><b>{plan.splits.length}</b> split{plan.splits.length === 1 ? '' : 's'} to add</span>}
        </>
      }
      busy={busy}
      onCancel={onCancel}
      primaryLabel={noop ? 'Nothing to import' : `Import ${plan.counts.imported} trade${plan.counts.imported === 1 ? '' : 's'}`}
      primaryDisabled={!canImport}
      onPrimary={() => void commit().catch(() => {})}
    >
      {stale && <StaleBanner onRefresh={() => setReviewedRevision(revision)} />}
      {noop && <div className="ir-banner" aria-live="polite">Nothing new: every row is already in your ledger. Re-importing changes nothing.</div>}

      <h3 className="ir-h">Report trades</h3>
      <label className="ir-toggle"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show rows already in the ledger</label>
      <div className="ir-table-wrap">
        <table className="ir-table">
          <thead>
            <tr><th>Trade date</th><th>Side</th><th>Symbol</th><th className="num">Qty</th><th className="num">Price</th><th className="num">Fees</th><th className="num">Value</th><th>Status</th><th>Decision</th></tr>
          </thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={9} className="muted">No rows to show.</td></tr>}
            {shown.map((row) => (
              <tr key={row.externalId} className={`ir-${row.status}`}>
                <td data-label="Trade date">{row.trade.date}<small>Trade No. {row.trade.tradeNo}</small></td>
                <td data-label="Side">{row.trade.kind}</td>
                <td data-label="Symbol"><b>{row.trade.ticker}</b></td>
                <td data-label="Qty" className="num">{row.trade.shares}</td>
                <td data-label="Price" className="num">{row.trade.price}</td>
                <td data-label="Fees" className="num">{row.trade.fees.toFixed(2)}</td>
                <td data-label="Value" className="num">{money(row.trade.shares * row.trade.price)}</td>
                <td data-label="Status">{STATUS_LABEL[row.status]}{row.candidates.map((c) => <small key={c.id}>{c.reason}</small>)}</td>
                <td data-label="Decision">
                  {row.status === 'new' && (
                    <label className="ir-toggle"><input type="checkbox" checked={row.action === 'import'} onChange={(e) => resolve(row.externalId, { action: e.target.checked ? 'import' : 'skip' })} /> Import</label>
                  )}
                  {row.status === 'ambiguous' && (
                    <select aria-label={`Decision for ${row.trade.ticker} ${row.trade.shares}`} value={resolutions[row.externalId]?.action ?? ''}
                      onChange={(e) => resolve(row.externalId, { action: e.target.value as 'import' | 'skip' })}>
                      <option value="" disabled>Decide…</option>
                      <option value="skip">Same trade as the one in my ledger (skip)</option>
                      <option value="import">A different trade (import it)</option>
                    </select>
                  )}
                  {row.status === 'previously-removed' && (
                    <label className="ir-toggle"><input type="checkbox" checked={row.action === 'import'} onChange={(e) => resolve(row.externalId, { action: e.target.checked ? 'import' : 'skip' })} /> Import again</label>
                  )}
                  {row.status === 'duplicate' && <span className="muted">Skipped</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <SplitSection review={splitReview} />
      <HoldingsAfter changes={plan.holdingChanges} newCompanies={plan.newCompanies} companyState={companyState} />
      <Notes warnings={plan.warnings} blockers={plan.blockers} />
    </ReviewShell>
  );
}
