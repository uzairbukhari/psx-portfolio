'use client';

import { useEffect, useMemo, useState } from 'react';
import type { IpoOffersResponse } from '@/lib/api-types';
import { applyIpoListPlan, ipoPlanIsNoop, planIpoListImport, ipoOutcome, type IpoAllotment, type IpoResolution, type IpoRowStatus } from '@/lib/ipo-list-import';
import type { IpoLookup } from '@/lib/ipo-offers';
import { money, type Portfolio } from '@/lib/portfolio';
import { readJson } from '@/lib/safe-json';
import { useCompanyStates } from './use-company-lookup';
import { HoldingsAfter, Notes, ReviewShell, SplitSection, StaleBanner } from './import-review-parts';
import { useSplitReview } from './use-split-review';

const STATUS_LABEL: Record<IpoRowStatus, string> = {
  new: 'Allotted', duplicate: 'Already in ledger', 'previously-removed': 'Removed earlier', ambiguous: 'Needs decision',
  'not-allotted': 'Not allotted', pending: 'Not final yet',
};

export function IpoImportDialog({
  items, fileName, portfolio, revision, busy, onCancel, onCommit,
}: {
  items: IpoAllotment[];
  fileName: string;
  portfolio: Portfolio;
  revision: number;
  busy: boolean;
  onCancel: () => void;
  onCommit: (next: Portfolio, message: string) => Promise<void>;
}) {
  const [resolutions, setResolutions] = useState<Record<string, IpoResolution>>({});
  const [ipo, setIpo] = useState<Record<string, IpoLookup>>({});
  const [showAll, setShowAll] = useState(false);
  const [reviewedRevision, setReviewedRevision] = useState(revision);
  const stale = revision !== reviewedRevision;

  // Official offer prices and allotment dates, where we hold hand-checked evidence (tickers only leave the device).
  const allottedTickers = useMemo(() => [...new Set(items.filter((i) => ipoOutcome(i) === 'allotted').map((i) => i.ticker))].sort(), [items]);
  useEffect(() => {
    let live = true;
    for (let i = 0; i < allottedTickers.length; i += 5) {
      void fetch(`/api/ipo-offers?tickers=${allottedTickers.slice(i, i + 5).join(',')}`)
        .then((response) => (response.ok ? (readJson(response) as Promise<IpoOffersResponse>) : null))
        .then((data) => { if (live && data) setIpo((current) => ({ ...current, ...Object.fromEntries(data.lookups.map((l) => [l.ticker, l])) })); })
        .catch(() => {});
    }
    return () => { live = false; };
  }, [allottedTickers]);

  const activity = useMemo(() => items.filter((i) => ipoOutcome(i) === 'allotted').map((i) => ({ ticker: i.ticker, date: i.endDate })), [items]);
  const splitReview = useSplitReview(portfolio, activity);
  const plan = useMemo(
    () => planIpoListImport(portfolio, items, { resolutions, ipo, splits: splitReview.splits }),
    [portfolio, items, resolutions, ipo, splitReview.splits],
  );
  const companyState = useCompanyStates(plan.newCompanies);
  const noop = ipoPlanIsNoop(plan);
  const shown = plan.rows.filter((r) => showAll || r.status !== 'duplicate');
  const canImport = !stale && !plan.blockers.length && !noop && !busy;
  const resolve = (id: string, patch: IpoResolution) => setResolutions((r) => ({ ...r, [id]: { ...r[id], ...patch } }));

  async function commit() {
    const next = applyIpoListPlan(portfolio, plan);
    const superseded = plan.rows.reduce((n, r) => n + r.supersedes.length, 0);
    const parts = [
      `${plan.counts.imported} IPO allotment${plan.counts.imported === 1 ? '' : 's'} imported`,
      superseded ? `${superseded} assumed acquisition${superseded === 1 ? '' : 's'} replaced by the real allotment` : '',
      plan.splits.length ? `${plan.splits.length} stock split${plan.splits.length === 1 ? '' : 's'} added` : '',
      plan.counts.duplicate ? `${plan.counts.duplicate} already in your ledger` : '',
      plan.newCompanies.length ? `added ${plan.newCompanies.length} unapproved compan${plan.newCompanies.length === 1 ? 'y' : 'ies'}` : '',
    ].filter(Boolean);
    await onCommit(next, parts.join('. ') + '.');
  }

  return (
    <ReviewShell
      title="Review IPO allotments"
      description={`${fileName}. Only shares you were actually allotted are added, at the amount you paid after any refund. Nothing is saved until you import. The file was read in your browser; it was not uploaded.`}
      summary={
        <>
          <span><b>{items.length}</b> subscriptions</span>
          <span><b>{plan.counts.imported}</b> to import</span>
          <span><b>{plan.counts.duplicate}</b> already in ledger</span>
          {plan.counts.skipped > 0 && <span><b>{plan.counts.skipped}</b> not allotted or not final</span>}
          {plan.counts.ambiguous > 0 && <span><b>{plan.counts.ambiguous}</b> need a decision</span>}
          {plan.splits.length > 0 && <span><b>{plan.splits.length}</b> split{plan.splits.length === 1 ? '' : 's'} to add</span>}
        </>
      }
      busy={busy}
      onCancel={onCancel}
      primaryLabel={noop ? 'Nothing to import' : `Import ${plan.counts.imported} allotment${plan.counts.imported === 1 ? '' : 's'}`}
      primaryDisabled={!canImport}
      onPrimary={() => void commit().catch(() => {})}
    >
      {stale && <StaleBanner onRefresh={() => setReviewedRevision(revision)} />}
      {noop && <div className="ir-banner" aria-live="polite">Nothing new: every allotment is already in your ledger. Re-importing changes nothing.</div>}

      <h3 className="ir-h">Subscriptions</h3>
      <label className="ir-toggle"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show rows already in the ledger</label>
      <div className="ir-table-wrap">
        <table className="ir-table">
          <thead>
            <tr><th>Company</th><th className="num">Applied</th><th className="num">Allotted</th><th className="num">Paid</th><th className="num">Refund</th><th className="num">Price paid</th><th>Date</th><th>Status</th><th>Decision</th></tr>
          </thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={9} className="muted">No rows to show.</td></tr>}
            {shown.map((row) => {
              const editable = row.status === 'new' || row.status === 'ambiguous' || row.status === 'previously-removed';
              return (
                <tr key={row.externalId} className={`ir-${row.status}`}>
                  <td><b>{row.item.ticker}</b><small>{row.item.name}{row.item.offerType ? ` · ${row.item.offerType}` : ''}</small></td>
                  <td className="num">{row.item.applied}</td>
                  <td className="num">
                    {editable ? (
                      <input type="number" min="1" step="1" aria-label={`Allotted shares for ${row.item.ticker}`} value={row.shares}
                        onChange={(e) => resolve(row.externalId, { shares: Number(e.target.value) })} style={{ width: 90 }} />
                    ) : row.item.allotted}
                  </td>
                  <td className="num">{money(row.item.amountPaid)}</td>
                  <td className="num">{row.item.refund ? money(row.item.refund) : '–'}</td>
                  <td className="num">{row.price > 0 && editable ? row.price.toFixed(2) : '–'}</td>
                  <td>
                    {editable ? (
                      <input type="date" aria-label={`Allotment date for ${row.item.ticker}`} value={row.date}
                        onChange={(e) => resolve(row.externalId, { date: e.target.value })} />
                    ) : row.item.endDate}
                    {editable && row.dateInferred && <small>subscription end date; edit if you know the allotment day</small>}
                  </td>
                  <td>
                    {STATUS_LABEL[row.status]}
                    {row.flags.map((f, i) => <small key={i}>{f}</small>)}
                    {row.candidates.map((c) => <small key={c.id}>{c.reason}</small>)}
                    {row.supersedes.length > 0 && <small>Replaces {row.supersedes.map((s) => `an assumed acquisition of ${s.shares}`).join(', ')} from an earlier import.</small>}
                  </td>
                  <td>
                    {row.status === 'new' && (
                      <label className="ir-toggle"><input type="checkbox" checked={row.action === 'import'} onChange={(e) => resolve(row.externalId, { action: e.target.checked ? 'import' : 'skip' })} /> Import</label>
                    )}
                    {row.status === 'ambiguous' && (
                      <select aria-label={`Decision for ${row.item.ticker}`} value={resolutions[row.externalId]?.action ?? ''}
                        onChange={(e) => resolve(row.externalId, { action: e.target.value as 'import' | 'skip' })}>
                        <option value="" disabled>Decide…</option>
                        <option value="skip">Same purchase as my entry (skip)</option>
                        <option value="import">A different purchase (import it)</option>
                      </select>
                    )}
                    {row.status === 'previously-removed' && (
                      <label className="ir-toggle"><input type="checkbox" checked={row.action === 'import'} onChange={(e) => resolve(row.externalId, { action: e.target.checked ? 'import' : 'skip' })} /> Import again</label>
                    )}
                    {(row.status === 'duplicate' || row.status === 'not-allotted' || row.status === 'pending') && <span className="muted">Skipped</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <SplitSection review={splitReview} />
      <HoldingsAfter changes={plan.holdingChanges} newCompanies={plan.newCompanies} companyState={companyState} />
      <Notes warnings={plan.warnings} blockers={plan.blockers} />
    </ReviewShell>
  );
}
