'use client';

import { useEffect, useMemo, useState } from 'react';
import type { IpoOffersResponse } from '@/lib/api-types';
import { useCompanyStates } from './use-company-lookup';
import type { AhlLedgerStatement } from '@/lib/ahl-ledger-pdf';
import { applyAhlLedgerPlan, planAhlLedgerImport, planIsNoop, type RowResolution } from '@/lib/ahl-reconcile';
import type { IpoLookup } from '@/lib/ipo-offers';
import { money, type Portfolio } from '@/lib/portfolio';
import { HoldingsAfter, Notes, ReviewShell, SplitSection, StaleBanner } from './import-review-parts';
import { useSplitReview } from './use-split-review';
import { readJson } from '@/lib/safe-json';

const STATUS_LABEL = { new: 'New', duplicate: 'Already in ledger', 'previously-removed': 'Removed earlier', ambiguous: 'Needs decision' } as const;
const CATEGORY_LABEL: Record<string, string> = {
  deposit: 'Deposits', withdrawal: 'Withdrawals', interest: 'Cash interest', charge: 'Account charges', tax: 'Tax deductions', other: 'Other entries',
};

export function AhlImportDialog({
  statement, fileName, portfolio, revision, busy, onCancel, onCommit,
}: {
  statement: AhlLedgerStatement;
  fileName: string;
  portfolio: Portfolio;
  revision: number;
  busy: boolean;
  onCancel: () => void;
  onCommit: (next: Portfolio, message: string) => Promise<void>;
}) {
  const [resolutions, setResolutions] = useState<Record<string, RowResolution>>({});
  const [edits, setEdits] = useState<Record<string, { price?: number; date?: string }>>({});
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});
  const [ipo, setIpo] = useState<Record<string, IpoLookup>>({});
  const [ipoNote, setIpoNote] = useState<Record<string, string>>({});
  const [showAll, setShowAll] = useState(false);
  // The revision this preview was reviewed against. If the ledger changes underneath it, the preview is
  // recomputed from the new ledger and the user must look at it again before importing.
  const [reviewedRevision, setReviewedRevision] = useState(revision);
  const stale = revision !== reviewedRevision;

  const activity = useMemo(
    () => statement.trades.map((t) => ({ ticker: t.ticker, date: t.executionDate, price: t.price })),
    [statement],
  );
  const splitReview = useSplitReview(portfolio, activity);
  const plan = useMemo(
    () => planAhlLedgerImport(portfolio, statement, { resolutions, inferredEdits: edits, acceptedIpo: accepted, ipo, splits: splitReview.splits }),
    [portfolio, statement, resolutions, edits, accepted, ipo, splitReview.splits],
  );
  const companyState = useCompanyStates(plan.newCompanies);
  const needIpo = useMemo(() => [...new Set(plan.inferred.map((i) => i.ticker))].sort().join(','), [plan.inferred]);

  async function loadIpo(tickers: string) {
    if (!tickers) return null;
    const response = await fetch(`/api/ipo-offers?tickers=${tickers}`);
    if (!response.ok) return null;
    const data = (await readJson(response)) as IpoOffersResponse;
    setIpo((current) => ({ ...current, ...Object.fromEntries(data.lookups.map((l) => [l.ticker, l])) }));
    return data;
  }
  useEffect(() => {
    if (!needIpo) return;
    let live = true;
    void fetch(`/api/ipo-offers?tickers=${needIpo}`)
      .then((response) => (response.ok ? (response.json() as Promise<IpoOffersResponse>) : null))
      .then((data) => {
        if (live && data) setIpo((current) => ({ ...current, ...Object.fromEntries(data.lookups.map((l) => [l.ticker, l])) }));
      })
      .catch(() => {});
    return () => { live = false; };
  }, [needIpo]);

  async function lookUp(ticker: string) {
    setIpoNote((n) => ({ ...n, [ticker]: 'Asking GitHub Actions to read PSX’s official offer documents…' }));
    try {
      const response = await fetch('/api/ipo-offers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tickers: [ticker] }),
      });
      const data = (await readJson(response)) as IpoOffersResponse & { error?: string };
      if (!response.ok) throw new Error(data.error);
      setIpoNote((n) => ({ ...n, [ticker]: data.message ?? '' }));
      for (let i = 0; i < 40 && data.queued?.length; i++) {
        await new Promise((resolve) => setTimeout(resolve, 6000));
        const status = await loadIpo(ticker);
        if (status && status.overall !== 'queued' && status.overall !== 'running') {
          setIpoNote((n) => ({ ...n, [ticker]: status.overall === 'failed' ? (status.states[0]?.error ?? 'The lookup failed.') : 'Lookup finished.' }));
          break;
        }
      }
    } catch (error) {
      setIpoNote((n) => ({ ...n, [ticker]: error instanceof Error ? error.message : String(error) }));
    }
  }

  const resolve = (identity: string, patch: RowResolution) => setResolutions((r) => ({ ...r, [identity]: { ...r[identity], ...patch } }));
  const noop = planIsNoop(plan);
  const shown = plan.rows.filter((r) => showAll || r.status !== 'duplicate');
  const canImport = !stale && !plan.blockers.length && !noop && !busy;

  async function commit() {
    const next = applyAhlLedgerPlan(portfolio, plan);
    const parts = [
      `${plan.counts.imported} AHL trade${plan.counts.imported === 1 ? '' : 's'} imported`,
      plan.inferred.filter((i) => i.change !== 'keep').length ? `${plan.inferred.filter((i) => i.change !== 'keep').length} assumed acquisition(s) added` : '',
      plan.splits.length ? `${plan.splits.length} stock split${plan.splits.length === 1 ? '' : 's'} added` : '',
      plan.counts.duplicate ? `${plan.counts.duplicate} already in your ledger` : '',
      plan.newCompanies.length ? `added ${plan.newCompanies.length} unapproved compan${plan.newCompanies.length === 1 ? 'y' : 'ies'}` : '',
    ].filter(Boolean);
    await onCommit(next, parts.join('. ') + '.');
  }

  const summary = (
    <>
      <span><b>{statement.trades.length}</b> trades ({statement.trades.filter((t) => t.kind === 'buy').length} buys, {statement.trades.filter((t) => t.kind === 'sell').length} sells)</span>
      <span><b>{plan.counts.imported}</b> to import</span>
      <span><b>{plan.counts.duplicate}</b> already in ledger</span>
      {plan.counts.ambiguous > 0 && <span><b>{plan.counts.ambiguous}</b> need a decision</span>}
      {plan.counts.removed > 0 && <span><b>{plan.counts.removed}</b> removed earlier</span>}
      {plan.splits.length > 0 && <span><b>{plan.splits.length}</b> split{plan.splits.length === 1 ? '' : 's'} to add</span>}
    </>
  );

  return (
    <ReviewShell
      title="Review AHL statement import"
      description={`${fileName} · ${statement.from} to ${statement.to} (generated ${statement.generated}). Nothing is saved until you import. The statement was read in your browser; it was not uploaded.`}
      summary={summary}
      busy={busy}
      onCancel={onCancel}
      primaryLabel={noop ? 'Nothing to import' : `Import ${plan.counts.imported} trade${plan.counts.imported === 1 ? '' : 's'}`}
      primaryDisabled={!canImport}
      onPrimary={() => void commit().catch(() => {})}
    >
        {stale && <StaleBanner onRefresh={() => setReviewedRevision(revision)} />}

        {plan.excluded.length > 0 && (
          <p className="muted ir-excluded">
            Not imported (not trades): {plan.excluded.map((e) => `${CATEGORY_LABEL[e.category] ?? e.category} ${e.count}`).join(' · ')}.
            Account fingerprint {statement.accountFingerprint} (no name or account number is stored).
          </p>
        )}

        {noop && (
          <div className="ir-banner" aria-live="polite">Nothing new: every statement row is already in your ledger. Re-importing changes nothing.</div>
        )}

        <h3 className="ir-h">Statement trades</h3>
        <label className="ir-toggle"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show rows already in the ledger</label>
        <div className="ir-table-wrap">
          <table className="ir-table">
            <thead>
              <tr><th>Trade date</th><th>Side</th><th>Symbol</th><th className="num">Qty</th><th className="num">Price</th><th className="num">Fees</th><th className="num">Net cash</th><th>Status</th><th>Decision</th></tr>
            </thead>
            <tbody>
              {shown.length === 0 && <tr><td colSpan={9} className="muted">No rows to show.</td></tr>}
              {shown.map((row) => (
                <tr key={row.trade.identity} className={`ir-${row.status}`}>
                  <td>
                    {row.date}
                    <small>settled {row.trade.settlementDate} · {row.trade.settlement}{row.dateCertainty === 'inferred' ? ' · date unconfirmed' : ''}</small>
                  </td>
                  <td>{row.trade.kind}</td>
                  <td><b>{row.trade.ticker}</b></td>
                  <td className="num">{row.trade.shares}</td>
                  <td className="num">{row.trade.priceSnapped ? row.trade.price.toFixed(2) : row.trade.price.toFixed(4)}{!row.trade.priceSnapped && <small>average of fills</small>}</td>
                  <td className="num">{row.trade.fees.toFixed(2)}</td>
                  <td className="num">{money(row.trade.netCash)}</td>
                  <td>
                    {STATUS_LABEL[row.status]}
                    {row.candidates.map((c) => <small key={c.id}>{c.reason}</small>)}
                  </td>
                  <td>
                    {row.status === 'new' && row.needsResolution && (
                      <span className="ir-date">
                        <input type="date" aria-label={`Execution date for ${row.trade.ticker}`} defaultValue={row.trade.executionDate} max={row.trade.settlementDate}
                          onChange={(e) => setResolutions((r) => ({ ...r, [row.trade.identity]: { ...r[row.trade.identity], date: e.target.value } }))} />
                        <button type="button" className="secondary compact" onClick={() => resolve(row.trade.identity, { date: resolutions[row.trade.identity]?.date ?? row.trade.executionDate })}>Confirm date</button>
                        <small>{row.resolutionReason}</small>
                      </span>
                    )}
                    {row.status === 'new' && !row.needsResolution && (
                      <label className="ir-toggle"><input type="checkbox" checked={row.action === 'import'} onChange={(e) => resolve(row.trade.identity, { action: e.target.checked ? 'import' : 'skip' })} /> Import</label>
                    )}
                    {row.status === 'ambiguous' && (
                      <select aria-label={`Decision for ${row.trade.ticker} ${row.trade.shares}`} value={resolutions[row.trade.identity]?.action ?? ''}
                        onChange={(e) => resolve(row.trade.identity, { action: e.target.value as 'import' | 'skip' })}>
                        <option value="" disabled>Decide…</option>
                        <option value="skip">Same trade as the one in my ledger (skip)</option>
                        <option value="import">A different trade (import it)</option>
                      </select>
                    )}
                    {row.status === 'previously-removed' && (
                      <label className="ir-toggle"><input type="checkbox" checked={row.action === 'import'} onChange={(e) => resolve(row.trade.identity, { action: e.target.checked ? 'import' : 'skip' })} /> Import again</label>
                    )}
                    {row.status === 'duplicate' && <span className="muted">Skipped</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <SplitSection review={splitReview} />

        {plan.inferred.length > 0 && (
          <>
            <h3 className="ir-h">Sales with no purchase history</h3>
            <p className="muted">
              These sales exceed what your ledger and the statement show you bought. As you requested, the missing quantity is assumed to be an IPO
              subscription at the official offer price, or, if that cannot be verified, a purchase one calendar day before the sale at the gross selling
              price with zero fees. These are estimates, not broker records; you can edit them and they stay marked as assumed.
            </p>
            {plan.inferred.map((item) => {
              const lookup = ipo[item.ticker];
              return (
                <div key={item.forSale} className="ir-assumed">
                  <span><b>{item.ticker}</b>: {item.shares} shares assumed bought (sale on {item.saleDate})</span>
                  <small>{item.pricing.basis === 'ipo-offer' ? 'IPO offer price' : 'Fallback estimate'}: {item.pricing.label}</small>
                  {lookup?.status === 'found' && (
                    <small>
                      Official evidence ({lookup.verification === 'curated' ? 'checked by hand' : 'read from documents by code'}): offer Rs {lookup.offerPrice}
                      {lookup.allotmentDate ? `, allotment ${lookup.allotmentDate}` : ''}{lookup.listingDate ? `, listing ${lookup.listingDate}` : ''}.{' '}
                      {lookup.evidence.map((e) => <a key={e.url} href={e.url} target="_blank" rel="noreferrer">{e.title}</a>)}
                    </small>
                  )}
                  {lookup?.status === 'not-found' && <small>Official lookup: {lookup.reason}</small>}
                  {lookup?.status === 'failed' && <small>Official lookup failed: {lookup.error}</small>}
                  {item.needsAcceptance && (
                    <label className="ir-toggle"><input type="checkbox" checked={!!accepted[item.ticker]} onChange={(e) => setAccepted((a) => ({ ...a, [item.ticker]: e.target.checked }))} /> I checked those documents: use this offer price</label>
                  )}
                  <span className="ir-inline">
                    <label>Price (PKR) <input type="number" step="any" min="0" value={item.price} onChange={(e) => setEdits((x) => ({ ...x, [item.forSale]: { ...x[item.forSale], price: Number(e.target.value) } }))} /></label>
                    <label>Date <input type="date" value={item.date} max={item.saleDate} onChange={(e) => setEdits((x) => ({ ...x, [item.forSale]: { ...x[item.forSale], date: e.target.value } }))} /></label>
                    {!(lookup?.status === 'found' && lookup.verification === 'curated') && (
                      <button type="button" className="secondary compact" onClick={() => void lookUp(item.ticker)}>Look up official IPO price</button>
                    )}
                  </span>
                  {ipoNote[item.ticker] && <small aria-live="polite">{ipoNote[item.ticker]}</small>}
                  {item.change === 'replace' && <small>Replaces an earlier assumption, now partly covered by real purchases.</small>}
                </div>
              );
            })}
          </>
        )}

        {(plan.replacedOpenings.length > 0 || plan.voidedInferred.length > 0) && (
          <>
            <h3 className="ir-h">Reconciled with your ledger</h3>
            <ul className="ir-list">
              {plan.replacedOpenings.map((o) => <li key={o.id}>Opening balance of {o.shares} {o.ticker} (dated {o.date}) is replaced by this statement’s history; it is voided, not deleted.</li>)}
              {plan.voidedInferred.map((v) => <li key={v.id}>Assumed acquisition of {v.shares} {v.ticker} is voided: {v.reason}</li>)}
            </ul>
          </>
        )}

        <HoldingsAfter changes={plan.holdingChanges} newCompanies={plan.newCompanies} companyState={companyState} />
        <Notes warnings={plan.warnings} blockers={plan.blockers} />
    </ReviewShell>
  );
}
