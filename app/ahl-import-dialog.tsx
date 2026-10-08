'use client';

import { useEffect, useMemo, useState } from 'react';
import type { IpoOffersResponse } from '@/lib/api-types';
import { useCompanyStates } from './use-company-lookup';
import type { AhlLedgerStatement } from '@/lib/ahl-ledger-pdf';
import { applyAhlLedgerPlan, planAhlLedgerImport, planIsNoop, type RowResolution } from '@/lib/ahl-reconcile';
import type { IpoLookup } from '@/lib/ipo-offers';
import type { Portfolio } from '@/lib/portfolio';
import { buildTodos, dateRangeLabel, dayMonth, fmtRs, footerStatus, openTodos, plural } from '@/lib/import-review-format';
import {
  DecisionCompare, FilterChips, HoldingsAfter, MethodChip, ReviewRows, ReviewSection, ReviewShell, ReviewSidebar, RowSwitch, SplitSection, StaleBanner, StatTiles,
  type ReviewRowData,
} from './import-review-parts';
import { useSplitReview } from './use-split-review';
import { readJson } from '@/lib/safe-json';

const STATUS_LABEL = { new: 'New', duplicate: 'Already recorded', 'previously-removed': 'Removed earlier', ambiguous: 'Needs decision' } as const;
const CATEGORY_LABEL: Record<string, string> = {
  deposit: 'Deposits', withdrawal: 'Withdrawals', interest: 'Cash interest', charge: 'Account charges', tax: 'Tax deductions', other: 'Other entries',
};

export function AhlImportDialog({
  statement, fileName, destination, portfolio, revision, busy, onCancel, onCommit, onViewActivity,
}: {
  statement: AhlLedgerStatement;
  fileName: string;
  destination: string;
  portfolio: Portfolio;
  revision: number;
  busy: boolean;
  onCancel: () => void;
  onCommit: (next: Portfolio, message: string) => Promise<void>;
  onViewActivity?: () => void;
}) {
  const [resolutions, setResolutions] = useState<Record<string, RowResolution>>({});
  const [edits, setEdits] = useState<Record<string, { price?: number; date?: string }>>({});
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});
  const [ipo, setIpo] = useState<Record<string, IpoLookup>>({});
  const [ipoNote, setIpoNote] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState('all');
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
  const nameOf = (ticker: string) => portfolio.companies.find((c) => c.ticker === ticker)?.name;

  const undecided = plan.rows.filter((r) => r.status === 'ambiguous' && !resolutions[r.trade.identity]?.action);
  const unconfirmed = plan.rows.filter((r) => r.status === 'new' && r.needsResolution);
  const todos = buildTodos({
    decisions: [
      ...(plan.rows.some((r) => r.status === 'ambiguous')
        ? [{ key: 'decide', text: undecided.length ? `Decide ${undecided.length} ${plural(undecided.length, 'trade')} that may already be in your ledger` : 'Possible duplicates decided', done: undecided.length === 0, anchor: undecided[0] ? `rv-${undecided[0].trade.identity}` : undefined }]
        : []),
      ...(unconfirmed.length || plan.rows.some((r) => resolutions[r.trade.identity]?.date)
        ? [{ key: 'dates', text: unconfirmed.length ? `Confirm ${unconfirmed.length} execution ${plural(unconfirmed.length, 'date')}` : 'Execution dates confirmed', done: unconfirmed.length === 0, anchor: unconfirmed[0] ? `rv-${unconfirmed[0].trade.identity}` : undefined }]
        : []),
    ],
    blockers: plan.blockers,
    covered: /need your decision/,
  });
  const open = openTodos(todos);
  const canImport = !stale && open === 0 && !noop && !busy;

  async function commit() {
    const next = applyAhlLedgerPlan(portfolio, plan);
    const parts = [
      `${plan.counts.imported} AHL ${plural(plan.counts.imported, 'trade')} imported`,
      plan.inferred.filter((i) => i.change !== 'keep').length ? `${plan.inferred.filter((i) => i.change !== 'keep').length} assumed ${plural(plan.inferred.filter((i) => i.change !== 'keep').length, 'acquisition')} added` : '',
      plan.splits.length ? `${plan.splits.length} stock ${plural(plan.splits.length, 'split')} added` : '',
      plan.counts.duplicate ? `${plan.counts.duplicate} already in your ledger` : '',
      plan.newCompanies.length ? `added ${plan.newCompanies.length} unapproved ${plural(plan.newCompanies.length, 'company', 'companies')}` : '',
    ].filter(Boolean);
    const message = parts.join('. ') + '.';
    await onCommit(next, message);
    return message;
  }

  const data: ReviewRowData[] = plan.rows.map((row) => {
    const t = row.trade;
    const id = t.identity;
    const decided = resolutions[id]?.action;
    const needsDate = row.status === 'new' && row.needsResolution;
    const group = needsDate || row.status === 'ambiguous' ? 'decide' : row.status === 'new' ? 'new' : row.status === 'duplicate' ? 'recorded' : 'skipped';
    const toggle = <RowSwitch on={row.action === 'import'} label={`Import ${t.ticker} ${t.kind} on ${dayMonth(row.date)}`} onChange={(on) => resolve(id, { action: on ? 'import' : 'skip' })} />;
    return {
      key: id, anchor: `rv-${id}`, date: row.date, side: t.kind, ticker: t.ticker, name: nameOf(t.ticker),
      tag: plan.newCompanies.includes(t.ticker) ? 'NEW' : undefined, qty: t.shares, price: t.price, fees: t.fees, value: t.shares * t.price,
      priceNote: t.priceSnapped ? undefined : 'average of fills',
      notes: [`Settled ${dayMonth(t.settlementDate)} · ${t.settlement}${row.dateCertainty === 'inferred' ? ' · date unconfirmed' : ''}`, ...row.candidates.map((c) => c.reason)],
      status: { label: needsDate ? 'Confirm date' : STATUS_LABEL[row.status], tone: row.status === 'new' && !needsDate ? 'new' : row.status === 'duplicate' ? 'dup' : row.status === 'previously-removed' ? 'off' : 'amb' },
      group, dim: row.status === 'duplicate' || (row.status !== 'ambiguous' && !needsDate && row.action === 'skip'), attention: needsDate || (row.status === 'ambiguous' && !decided),
      control: row.status === 'duplicate' ? <span className="muted">Skipped</span> : row.status === 'ambiguous' || needsDate ? null : toggle,
      extra: needsDate ? (
        <div className="rv-extra">
          <label>Execution date
            <input type="date" aria-label={`Execution date for ${t.ticker}`} defaultValue={t.executionDate} max={t.settlementDate}
              onChange={(e) => setResolutions((r) => ({ ...r, [id]: { ...r[id], date: e.target.value } }))} />
          </label>
          <button type="button" className="secondary compact" onClick={() => resolve(id, { date: resolutions[id]?.date ?? t.executionDate })}>Confirm date</button>
          <small>{row.resolutionReason}</small>
        </div>
      ) : row.status === 'ambiguous' ? (
        <DecisionCompare
          statement={<>{dayMonth(row.date)} · {t.kind} {t.shares} @ {t.price}</>}
          ledger={row.candidates.map((c) => <div key={c.id}>{c.reason}</div>)}
          value={decided} onChange={(v) => resolve(id, { action: v })} />
      ) : undefined,
    };
  });
  const count = (g: ReviewRowData['group']) => data.filter((r) => r.group === g).length;
  const options = [
    { key: 'all', label: 'All', count: data.length },
    { key: 'new', label: 'New', count: count('new') },
    ...(count('decide') ? [{ key: 'decide', label: 'Needs decision', count: count('decide') }] : []),
    ...(count('recorded') ? [{ key: 'recorded', label: 'Already recorded', count: count('recorded') }] : []),
    ...(count('skipped') ? [{ key: 'skipped', label: 'Removed earlier', count: count('skipped') }] : []),
  ];
  const imported = plan.rows.filter((r) => r.action === 'import' && !r.needsResolution);
  const buys = imported.filter((r) => r.trade.kind === 'buy');
  const sells = imported.filter((r) => r.trade.kind === 'sell');
  const sum = (list: typeof imported) => list.reduce((a, r) => a + r.trade.shares * r.trade.price, 0);
  const notes = [
    ...plan.warnings,
    ...(plan.excluded.length ? [`Not imported (not trades): ${plan.excluded.map((e) => `${CATEGORY_LABEL[e.category] ?? e.category} ${e.count}`).join(' · ')}. Account fingerprint ${statement.accountFingerprint}; no name or account number is stored.`] : []),
  ];
  const sidebar = (
    <ReviewSidebar
      big={`${plan.counts.imported} ${plural(plan.counts.imported, 'trade')}`}
      sub={`${buys.length} ${plural(buys.length, 'buy')}, ${sells.length} ${plural(sells.length, 'sell')} into ${destination}`}
      lines={[
        ...(buys.length ? [['Bought for', fmtRs(sum(buys))] as [string, string]] : []),
        ...(sells.length ? [['Sold for', fmtRs(sum(sells))] as [string, string]] : []),
        ...(plan.inferred.length ? [['Assumed acquisitions', String(plan.inferred.length)] as [string, string]] : []),
        ...(plan.newCompanies.length ? [['New companies', plan.newCompanies.join(', ')] as [string, string]] : []),
        ...(plan.splits.length ? [['Stock splits', String(plan.splits.length)] as [string, string]] : []),
        ['Already recorded, skipped', String(plan.counts.duplicate)],
      ]}
      todos={todos} warnings={notes}
      privacy="Nothing is saved until you press Import. The statement was read in your browser; it was not uploaded."
    />
  );

  return (
    <ReviewShell
      title="AHL statement" destination={destination}
      subtitle={<>{fileName} · {dateRangeLabel([statement.from, statement.to])} (generated {statement.generated})</>}
      chips={<MethodChip method="browser" />}
      sidebar={sidebar} footer={footerStatus({ open, noop, stale })}
      busy={busy} onCancel={onCancel} onViewActivity={onViewActivity}
      primaryLabel={noop ? 'Nothing to import' : `Import ${plan.counts.imported} ${plural(plan.counts.imported, 'trade')}`}
      primaryDisabled={!canImport} onPrimary={commit}
    >
      {stale && <StaleBanner onRefresh={() => setReviewedRevision(revision)} />}
      {noop && <div className="ir-banner" aria-live="polite">Nothing new: every statement row is already in your ledger. Re-importing changes nothing.</div>}
      <StatTiles active={filter} onFilter={setFilter} tiles={[
        { key: 'new', value: count('new'), label: plural(count('new'), 'new trade'), filter: 'new' },
        { key: 'rec', value: count('recorded'), label: 'already recorded', filter: 'recorded' },
        { key: 'dec', value: open, label: 'to decide', warn: true, filter: 'decide' },
        { key: 'co', value: plan.newCompanies.length, label: plural(plan.newCompanies.length, 'new company', 'new companies') },
      ]} />

      <ReviewSection id="rv-sec-trades" step={1} title="Statement trades" state={undecided.length || unconfirmed.length ? 'todo' : 'done'}
        meta={`${data.length} on the statement · ${plan.counts.imported} selected`}>
        <FilterChips options={options} value={filter} onChange={setFilter} />
        <ReviewRows rows={data.filter((r) => filter === 'all' || r.group === filter)} empty={data.length ? 'Nothing in this view.' : 'No trades on this statement.'} />
      </ReviewSection>

      <SplitSection review={splitReview} />

      {plan.inferred.length > 0 && (
        <ReviewSection title="Sales with no purchase history" state="todo">
          <div className="rv-pad">
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
          </div>
        </ReviewSection>
      )}

      {(plan.replacedOpenings.length > 0 || plan.voidedInferred.length > 0) && (
        <ReviewSection title="Reconciled with your ledger" state="done">
          <div className="rv-pad">
            <ul className="ir-list">
              {plan.replacedOpenings.map((o) => <li key={o.id}>Opening balance of {o.shares} {o.ticker} (dated {o.date}) is replaced by this statement’s history; it is voided, not deleted.</li>)}
              {plan.voidedInferred.map((v) => <li key={v.id}>Assumed acquisition of {v.shares} {v.ticker} is voided: {v.reason}</li>)}
            </ul>
          </div>
        </ReviewSection>
      )}

      <ReviewSection step={2} title="Holdings after import" state="done">
        <HoldingsAfter changes={plan.holdingChanges} newCompanies={plan.newCompanies} companyState={companyState} />
      </ReviewSection>
    </ReviewShell>
  );
}
